import { loadEnv } from '@medusajs/framework/utils'
import { withMercur } from '@mercurjs/core'
import fs from 'fs'
import path from 'path'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

// Resolves where a dashboard app lives:
// - in the source tree (development): ../../apps/<name>
// - in the production build artifact: hosts that deploy only `.medusa/server` (for example
//   Medusa Cloud) get the panels bundled into ./dashboards/<name> by
//   scripts/bundle-dashboards.mjs during `build`. The compiled config runs from the
//   artifact root, so __dirname points there.
// In production (Railway) Redis backs Medusa's event bus, workflow engine, locking and cache.
// Locally the in-memory defaults are used unless REDIS_URL is set.
const redisUrl = process.env.REDIS_URL
const redisModules = redisUrl
  ? [
      { resolve: '@medusajs/medusa/event-bus-redis', options: { redisUrl } },
      { resolve: '@medusajs/medusa/workflow-engine-redis', options: { redis: { url: redisUrl } } },
      {
        resolve: '@medusajs/medusa/locking',
        options: {
          providers: [
            { resolve: '@medusajs/medusa/locking-redis', id: 'locking-redis', is_default: true, options: { redisUrl } },
          ],
        },
      },
    ]
  : []

// Buyers sign in with Clerk only. Verification is networkless with the instance's PEM public
// key (CLERK_JWT_KEY); the secret key is the fallback (fetches the JWKS). Without either, the
// provider isn't registered and customers can't sign in.
const clerkAuthProviders =
  process.env.CLERK_JWT_KEY || process.env.CLERK_SECRET_KEY
    ? [
        {
          resolve: './src/modules/clerk-auth',
          id: 'clerk',
          options: {
            jwtKey: process.env.CLERK_JWT_KEY,
            secretKey: process.env.CLERK_SECRET_KEY,
            authorizedParties: process.env.CLERK_AUTHORIZED_PARTIES?.split(',').filter(Boolean),
          },
        },
      ]
    : []

// Buyers pay with Paystack (docs/adr/0003-paystack-payments.md). Without a secret key the
// provider isn't registered and checkout can't take payment.
const paymentProviders = process.env.PAYSTACK_SECRET_KEY
  ? [
      {
        resolve: './src/modules/paystack',
        id: 'paystack',
        options: { secretKey: process.env.PAYSTACK_SECRET_KEY, apiUrl: process.env.PAYSTACK_API_URL || undefined },
      },
    ]
  : []

const dashboardAppDir = (name: string) => {
  const bundled = path.join(__dirname, 'dashboards', name)
  return fs.existsSync(bundled) ? bundled : path.join(__dirname, `../../apps/${name}`)
}

module.exports = withMercur({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl,
    workerMode: (process.env.MEDUSA_WORKER_MODE as 'shared' | 'worker' | 'server') || 'shared',
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      vendorCors: process.env.VENDOR_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
      // Clerk is the sole customer identity, verified on every store request by the
      // clerkCustomerAuth middleware. No /auth route issues customer tokens: not
      // email/password, and not a Clerk-for-Medusa token swap, which would outlive a Clerk
      // sign-out. Operators and seller members keep email/password.
      authMethodsPerActor: {
        customer: [],
      },
    }
  },
  featureFlags: {
    seller_registration: true,
    rbac: true,
  },
  modules: [
    ...redisModules,
    {
      resolve: '@medusajs/medusa/auth',
      options: {
        providers: [{ resolve: '@medusajs/medusa/auth-emailpass', id: 'emailpass' }, ...clerkAuthProviders],
      },
    },
    { resolve: '@medusajs/medusa/payment', options: { providers: paymentProviders } },
    // Shops deliver with Shipbubble (#23): live rates per shop at checkout. The provider refuses
    // to start without SHIPBUBBLE_API_KEY outside tests. Manual stays for Medusa's defaults.
    {
      resolve: '@medusajs/medusa/fulfillment',
      options: {
        providers: [
          { resolve: '@medusajs/medusa/fulfillment-manual', id: 'manual' },
          {
            resolve: './src/modules/shipbubble',
            id: 'shipbubble',
            options: { apiKey: process.env.SHIPBUBBLE_API_KEY, apiUrl: process.env.SHIPBUBBLE_API_URL || undefined },
          },
        ],
      },
    },
    // Medusa's default only has the admin "feed" channel. Emails (staff invites)
    // are logged by the local provider until a real email provider is configured.
    {
      resolve: '@medusajs/medusa/notification',
      options: {
        providers: [
          {
            resolve: '@medusajs/medusa/notification-local',
            id: 'local',
            options: { name: 'Local Notification Provider', channels: ['feed', 'email'] },
          },
        ],
      },
    },
    {
      resolve: '@mercurjs/core/modules/admin-ui',
      options: {
        appDir: dashboardAppDir('admin'),
        path: '/dashboard',
      }
    },
    {
      resolve: '@mercurjs/core/modules/vendor-ui',
      options: {
        appDir: dashboardAppDir('vendor'),
        path: '/seller',
      }
    },
    // Where each enriched product's data came from, and what enrichment decided (#35).
    { resolve: './src/modules/product-enrichment' },
    // Mercur's wishlist block: products a buyer saved, each from one shop (#32).
    { resolve: './src/modules/wishlist' },
    // Each seller order's place in the fulfilment state machine, and its refunds (#20).
    { resolve: './src/modules/order-fulfilment' },
    // Address search, place details and reverse geocode for the buyer's address (ADR 0002, #40).
    // Refuses to start without GOOGLE_MAPS_API_KEY outside tests.
    {
      resolve: './src/modules/address-lookup',
      options: {
        google: {
          apiKey: process.env.GOOGLE_MAPS_API_KEY,
          placesUrl: process.env.GOOGLE_PLACES_API_URL || undefined,
          geocodingUrl: process.env.GOOGLE_GEOCODING_API_URL || undefined,
        },
      },
    },
    // Shops' private offer cost prices and their saved import mappings (#37).
    { resolve: './src/modules/offer-import' },
    // Which categories and products are perishable, set by the operator only (#69).
    { resolve: './src/modules/perishable' },
    {
      resolve: '@medusajs/medusa/file',
      options: {
        providers: [
          {
            resolve: '@medusajs/medusa/file-local',
            id: 'local',
            options: {
              // The local provider bakes this into every uploaded file URL.
              // It must be the publicly reachable origin in production, or
              // images resolve to localhost and render broken.
              backend_url: process.env.FILE_BACKEND_URL || 'http://localhost:9000/static',
            },
          },
        ],
      },
    },
  ],
})
