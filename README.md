# Oja

Multi-vendor marketplace on [Mercur](https://mercurjs.com) (Medusa v2) with Expo buyer and vendor apps. Design: [`docs/design.md`](docs/design.md).

## Layout

| Path | What |
|---|---|
| `packages/api` | Mercur/Medusa backend |
| `apps/admin`, `apps/vendor` | Mercur operator and seller web panels (served by the API at `/dashboard` and `/seller`) |
| `apps/mobile-buyer`, `apps/mobile-vendor` | Expo apps |
| `packages/api-client` | Typed client shared by the mobile apps |
| `apps/storefront` | Mercur's Next.js storefront — reference only |

## Local development

Requires Bun 1.4, Node 22 and Docker.

```bash
bun install
bun run db:up                                   # Postgres :5434, Valkey :6381
cp packages/api/.env.template packages/api/.env
cd packages/api
bun run medusa db:migrate && bun run seed       # Oja demo data; prints the publishable key
bun run dev                                     # API :9000, admin /dashboard, vendor /seller
```

Mobile apps (copy `.env.example` to `.env` in each; set the buyer app's `EXPO_PUBLIC_PUBLISHABLE_KEY` to the key the seed prints):

```bash
cd apps/mobile-buyer && bunx expo start
cd apps/mobile-vendor && bunx expo start        # log in with a seeded member below
```

### Buyer sign-in (Clerk)

Buyers sign in with Clerk only (Google, Apple, email); customer email/password is disabled in the API. One Clerk instance serves the buyer app and the API:

1. Clerk Dashboard → **Native applications**: enable the Native API and add the iOS app (bundle id from `appIdentity('buyer')`, team id) and the Android app. Apple sign-in needs this.
2. **User & authentication**: enable email, Google and Apple. Native Google needs the iOS, Android and web client ids configured on the Google connection.
3. **Sessions → Customize session token**: add the claims the API uses to create the customer on first sign-in:
   ```json
   { "email": "{{user.primary_email_address}}", "first_name": "{{user.first_name}}", "last_name": "{{user.last_name}}" }
   ```
4. **API keys**: put the publishable key in the buyer app's `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, and the PEM public key (Show JWT public key → PEM) in the API's `CLERK_JWT_KEY`, which verifies tokens without a network call.

The app sends the Clerk session token on every store request. The API verifies it, finds or creates the customer for that Clerk user id, and rejects an invalid or expired token. Sign-in uses Clerk's native `AuthView`, so it needs a development build (`bunx expo run:ios` / `run:android`), not Expo Go.

If a web client is ever added on the same Clerk instance, set the API's `CLERK_AUTHORIZED_PARTIES` to its origin (comma-separated for several) so the API accepts that site's tokens only from it. Native app tokens carry no origin and are unaffected, so it stays empty until then.

### Payments (Paystack)

Buyers pay with Paystack (`docs/adr/0003-paystack-payments.md`). Put the test secret key from Paystack's dashboard (Settings → API Keys & Webhooks) in the API's `PAYSTACK_SECRET_KEY`, then re-run `bun run seed`: it makes Paystack the Nigeria region's only payment provider. Without the key, the region keeps Medusa's no-charge system provider and checkout can't take payment.

Checkout starts a Paystack transaction and the app opens its payment page in a WebView. **An order is placed only when Paystack's `charge.success` webhook reaches the API**: the webhook's signature is checked, the transaction is verified with Paystack, the payment is captured and the cart splits into one order per shop. Test cards are listed in [Paystack's docs](https://paystack.com/docs/payments/test-payments/).

#### Paystack webhooks

Paystack must reach the API from the internet, so run a tunnel locally, for example with [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) (no account needed) or ngrok:

```bash
cloudflared tunnel --url http://localhost:9000   # prints https://<random>.trycloudflare.com
# or: ngrok http 9000
```

In Paystack's dashboard (Settings → API Keys & Webhooks, **test mode**) set the webhook URL to:

```
https://<tunnel-host>/hooks/payment/paystack_paystack
```

The tunnel's host changes each time it starts, so update the URL when it does. Pay a checkout in the buyer app with a test card: the API logs `Processing mercur.payment.webhook_received`, and the confirmation screen shows the orders. A webhook with a bad signature gets a `401`. Without a working tunnel the payment succeeds on Paystack's side, but no order is placed and the app keeps waiting for confirmation.

### Address lookup (Google)

Buyers find their delivery address with Google (#40, ADR 0002): the API's store routes suggest places, describe a place and reverse geocode the buyer's location, with the server key in `GOOGLE_MAPS_API_KEY` (Places API (New) and Geocoding API enabled); the API refuses to start without it. The buyer app's pin map needs Maps SDK keys of its own (see `apps/mobile-buyer/README.md`). Vendor responses never carry a buyer's pin.

### Delivery (Shipbubble)

Each shop's delivery is quoted live by Shipbubble (#23). Put the sandbox API key from Shipbubble's dashboard in the API's `SHIPBUBBLE_API_KEY`; the API refuses to start without it. Then re-run `bun run seed`: it gives every shop a Shipbubble delivery option (replacing the old flat rate).

At checkout the buyer's address is validated with Shipbubble (by the map pin when the address has one, ADR 0002) and its address code kept in the address's metadata; each shop's pickup address is validated the first time it is quoted. Each shop then offers best value (preselected), the cheapest and the fastest courier rate.

### Seed data

`bun run seed` (in `packages/api`) creates a Nigeria region in NGN with 7.5% VAT (tax-inclusive prices), the buyer app's sales channel and publishable key, and three Lagos shops, each offering its department's products from a small shared catalogue. A few products are sold by two shops at different prices (the charger and lantern at the grocery shop, plantain chips at the gadget hub), to demo shop-grouped search and listings. Re-running it only adds what's missing. It doesn't remove data from an older seed: to start clean, `docker compose down -v && bun run db:up`, then migrate and seed again.

Every seeded member's password is `supersecret`. Owners have the seller administration role; staff have order management.

| Shop | Department | Area (LGA) | Owner | Staff |
|---|---|---|---|---|
| Iya Bisi Foodstuff | Groceries | Surulere | `grocery.owner@oja.test` | `grocery.staff@oja.test` |
| Adire House | Fashion | Eti-Osa (Lekki) | `fashion.owner@oja.test` | `fashion.staff@oja.test` |
| Ikeja Gadget Hub | Electronics | Ikeja | `electronics.owner@oja.test` | `electronics.staff@oja.test` |

Each department's categories carry starter attributes (Storage and Shelf life; Fabric and Care instructions; Voltage and Warranty) and shipping defaults (weight, dimensions, package category) in `metadata.shipping_defaults`. Whenever a product is saved in a category, any weight, dimension or package category it lacks is filled from the category's defaults; values it already has are kept, and all stay editable. Re-running the seed also restores the starter attributes' required flags and category links. Products are seeded as proposals and published once their offers give them a price, through the same publish gate as everything else: a product can't be published without a title, a selling price, an image, a category, a weight and its category's required attributes (Storage, Fabric, Voltage). Products seeded before the gate lack those attributes, so start clean as above.

The data lives in `packages/api/src/scripts/seed-data.ts`.

Checks: `bun run codegen && bun run check-types && bun run test`.

## Deploy

`.railway/railway.ts` describes the Railway project (API server + worker, Postgres, Redis) as Infrastructure as Code ([ADR 0005](docs/adr/0005-railway-hosting.md)). It is not applied yet. Preview with `railway config plan` (Railway CLI 5.42.1 or newer) and apply with `railway config apply`.
