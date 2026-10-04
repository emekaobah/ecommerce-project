# Oja buyer app

Expo Router app for buyers. Architecture: [ADR 0001](../../docs/adr/0001-mobile-app-architecture.md).

## Run

1. Start the backend (`bun run dev` at the repo root).
2. `cp .env.example .env` and fill in the publishable key and the Maps SDK keys for the delivery pin map (`GOOGLE_MAPS_IOS_API_KEY`, `GOOGLE_MAPS_ANDROID_API_KEY`; config fails without them). On a physical device, use your machine's LAN IP for `EXPO_PUBLIC_API_URL`.
3. Build and open a dev build: `bunx expo run:ios` or `bunx expo run:android`.

## End-to-end flows

Maestro flows live in `.maestro/`. With the backend running (with `GOOGLE_MAPS_API_KEY`), the dev build open and a buyer signed in: `maestro test .maestro/add-address-by-search.yaml`.

## Layout

- `app.config.ts`: name, scheme (`oja://`) and bundle id come from `appIdentity` in `@oja/domain`.
- `src/app/`: routes only. Tabs (Home, Search, Cart, Orders, Account) in `(tabs)`; product, seller and checkout stacks and the sign-in modal at the root.
- `src/screens/<name>/`: screens rendered by routes.
- `src/api/`: the Store API client, and per-domain query keys and TanStack Query hooks.
- `src/region/`: resolves the shopping region from the backend and the device's country.
- `src/config/env.ts`: typed `EXPO_PUBLIC_*` env; the app fails fast if a value is missing.
