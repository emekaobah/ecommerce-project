// Railway Infrastructure as Code for the Oja backend (ADR 0005). Preview with
// `railway config plan`, apply with `railway config apply`; Railway doesn't read this
// file on deploy.
//
// One codebase runs as two services (Medusa server + worker), sharing Postgres and Redis.
// BullMQ (event bus / workflow engine) requires Redis's maxmemory-policy to be noeviction,
// which is Redis's default and isn't overridden by Railway's image.
import { defineRailway, github, group, postgres, project, redis, service } from "railway/iac"

// EU West (Amsterdam), Railway's closest region to Lagos.
const region = "europe-west4-drams3a"

const build = [
  "bun run codegen",
  "bun x turbo run build --filter=@acme/api",
  "cd packages/api/.medusa/server && npm install --omit=dev",
].join(" && ")
const start = "cd packages/api/.medusa/server && npx medusa start"

// Set by hand as shared variables on the environment. The secrets never live in the repo.
const sharedVariables = [
  "JWT_SECRET",
  "COOKIE_SECRET",
  // Public origin of the API, e.g. https://api.<domain>; baked into the panels at build time.
  "MERCUR_BACKEND_URL",
  "VITE_MERCUR_BACKEND_URL",
  // Google Maps JavaScript browser key (HTTP-referrer restricted) for the vendor panel's pickup
  // pin map (#41); baked into the panel at build time.
  "VITE_GOOGLE_MAPS_BROWSER_KEY",
  "STORE_CORS",
  "ADMIN_CORS",
  "VENDOR_CORS",
  "AUTH_CORS",
  // The vendor panel's public origin (`<api origin>/seller`); staff invite links use it.
  "MERCUR_VENDOR_URL",
  // Clerk PEM public key; verifies buyer session tokens without a network call.
  "CLERK_JWT_KEY",
  // Paystack secret key; starts and verifies payments and checks webhook signatures.
  "PAYSTACK_SECRET_KEY",
  // Shipbubble API key; validates delivery addresses and quotes courier rates (#23). Required.
  "SHIPBUBBLE_API_KEY",
  // Anthropic API key; Claude drafts catalogue fields no product database had (#36).
  "ANTHROPIC_API_KEY",
  // Google Cloud key for Places API (New) and Geocoding API; address lookup (ADR 0002). Required.
  "GOOGLE_MAPS_API_KEY",
  // Cloudflare R2 bucket for uploaded files (#19): the bucket's S3 API endpoint
  // (https://<account id>.r2.cloudflarestorage.com), an R2 API token's key pair scoped to the
  // bucket, and the bucket's public URL, which every file URL starts with.
  "S3_BUCKET",
  "S3_ENDPOINT",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_FILE_URL",
  // Sentry project DSN for the backend (#19); errors from the server and the worker.
  "SENTRY_DSN",
] as const

export default defineRailway((ctx) => {
  // Railway's Postgres (18), matching docker-compose.yml and CI.
  const db = postgres("oja-db", { region })
  const cache = redis("oja-redis", { region })

  const env = (workerMode: "server" | "worker") => ({
    NODE_ENV: "production",
    MEDUSA_WORKER_MODE: workerMode,
    DATABASE_URL: db.env.DATABASE_URL,
    REDIS_URL: cache.env.REDIS_URL,
    ...Object.fromEntries(sharedVariables.map((name) => [name, ctx.shared[name]])),
  })

  const source = github("emekaobah/ecommerce-project", { branch: "main" })

  const api = service("oja-api", {
    source,
    build,
    start,
    preDeploy: "cd packages/api/.medusa/server && npx medusa db:migrate",
    healthcheck: "/health",
    replicas: { [region]: 1 },
    env: env("server"),
  })

  const worker = service("oja-worker", {
    source,
    build,
    start,
    replicas: { [region]: 1 },
    env: env("worker"),
  })

  return project("oja", {
    resources: [group("Backend", [api, worker, db, cache])],
  })
})
