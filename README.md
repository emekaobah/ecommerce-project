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
bun run medusa db:migrate && bun run seed       # demo sellers/products + publishable key
bun run dev                                     # API :9000, admin /dashboard, vendor /seller
```

Mobile apps (copy `.env.example` to `.env` in each; the buyer app needs the publishable key from the admin panel):

```bash
cd apps/mobile-buyer && bunx expo start
cd apps/mobile-vendor && bunx expo start        # seeded login: seller@mercur.dev / supersecret
```

Checks: `bun run codegen && bun run check-types && bun run test`.

## Deploy

`render.yaml` describes the Render Blueprint (API server + worker, Postgres, Key Value). It is not applied yet.
