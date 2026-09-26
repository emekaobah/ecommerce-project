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

Requires Bun 1.3, Node 22 and Docker.

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

### Seed data

`bun run seed` (in `packages/api`) creates a Nigeria region in NGN with 7.5% VAT (tax-inclusive prices), the buyer app's sales channel and publishable key, and three Lagos shops, each offering its department's products from a small shared catalogue. A few products are sold by two shops at different prices (the charger and lantern at the grocery shop, plantain chips at the gadget hub), to demo shop-grouped search and listings. Re-running it only adds what's missing. It doesn't remove data from an older seed: to start clean, `docker compose down -v && bun run db:up`, then migrate and seed again.

Every seeded member's password is `supersecret`. Owners have the seller administration role; staff have order management.

| Shop | Department | Area (LGA) | Owner | Staff |
|---|---|---|---|---|
| Iya Bisi Foodstuff | Groceries | Surulere | `grocery.owner@oja.test` | `grocery.staff@oja.test` |
| Adire House | Fashion | Eti-Osa (Lekki) | `fashion.owner@oja.test` | `fashion.staff@oja.test` |
| Ikeja Gadget Hub | Electronics | Ikeja | `electronics.owner@oja.test` | `electronics.staff@oja.test` |

Each department's categories carry starter attributes (Storage and Shelf life; Fabric and Care instructions; Voltage and Warranty) and shipping defaults (weight, dimensions, package category) in `metadata.shipping_defaults`. A product created without its own weight or dimensions takes its category's; it can be edited afterwards. Products are seeded as proposals and published once their offers give them a price, through the same publish gate as everything else: a product can't be published without a title, a selling price, an image, a category, a weight and its category's required attributes (Storage, Fabric, Voltage). Products seeded before the gate lack those attributes, so start clean as above.

The data lives in `packages/api/src/scripts/seed-data.ts`.

Checks: `bun run codegen && bun run check-types && bun run test`.

## Deploy

`render.yaml` describes the Render Blueprint (API server + worker, Postgres, Key Value). It is not applied yet.
