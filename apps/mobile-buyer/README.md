# Oja buyer app

Expo Router app for buyers. Architecture: [ADR 0001](../../docs/adr/0001-mobile-app-architecture.md).

## Run

1. Start the backend (`bun run dev` at the repo root).
2. `cp .env.example .env` and fill in the publishable key. On a physical device, use your machine's LAN IP for `EXPO_PUBLIC_API_URL`.
3. Build and open a dev build: `bunx expo run:ios` or `bunx expo run:android`.

## Layout

- `app.config.ts`: name, scheme (`oja://`) and bundle id come from `appIdentity` in `@oja/domain`.
- `src/app/`: routes only. Tabs (Home, Search, Cart, Orders, Account) in `(tabs)`; product, seller and checkout stacks and the sign-in modal at the root.
- `src/screens/<name>/`: screens rendered by routes.
- `src/api/`: the Store API client, and per-domain query keys and TanStack Query hooks.
- `src/region/`: resolves the shopping region from the backend and the device's country.
- `src/config/env.ts`: typed `EXPO_PUBLIC_*` env; the app fails fast if a value is missing.
