# Oja buyer app

Expo Router app for buyers. Architecture: [ADR 0001](../../docs/adr/0001-mobile-app-architecture.md).

## Run

1. Start the backend (`bun run dev` at the repo root).
2. `cp .env.example .env` and fill in the publishable key and the Maps SDK keys for the delivery pin map (`GOOGLE_MAPS_IOS_API_KEY`, `GOOGLE_MAPS_ANDROID_API_KEY`; a build without them has no pin map). On a physical device, use your machine's LAN IP for `EXPO_PUBLIC_API_URL`.
3. Build and open a dev build: `bunx expo run:ios` or `bunx expo run:android`.

## End-to-end flows

Maestro flows live in `.maestro/`. With the backend running (with `GOOGLE_MAPS_API_KEY`) and the dev build open: `maestro test .maestro/add-address-by-search.yaml` (an address at checkout) or `maestro test .maestro/saved-addresses.yaml` (Account → Addresses: add, edit, checkout preselects the default, delete). Each flow signs in a Clerk test buyer (`sign-in.yaml`; a development instance accepts `+clerk_test` emails with code 424242), signing up on the first run. In a dev build, first turn off "Tools button" in the dev menu: the floating button sits over checkout's "Change" and takes its taps.

## Layout

- `app.config.ts`: name, scheme (`oja://`) and bundle id come from `appIdentity` in `@oja/domain`.
- `src/app/`: routes only. Tabs (Home, Search, Cart, Orders, Account) in `(tabs)`; product, seller and checkout stacks and the sign-in modal at the root.
- `src/screens/<name>/`: screens rendered by routes.
- `src/api/`: the Store API client, and per-domain query keys and TanStack Query hooks.
- `src/region/`: resolves the shopping region from the backend and the device's country.
- `src/push/`: once a buyer is signed in, asks for notification permission and registers the device's Expo push token (`POST /store/push-tokens`); sign-out removes it first. Tapping a push opens the screen its `url` names. Uses `expo-notifications`, a native module: rebuild the dev build after pulling it. Pushes need a physical device and `EAS_PROJECT_ID` in `.env` (from `eas init`), plus APNs/FCM credentials in EAS; without them the app runs and gets none.
- `src/config/env.ts`: typed `EXPO_PUBLIC_*` env; the app fails fast if a value is missing.
