# Oja buyer app

Expo Router app for buyers. Architecture: [ADR 0001](../../docs/adr/0001-mobile-app-architecture.md).

## Run

1. Start the backend (`bun run dev` at the repo root).
2. `cp .env.example .env` and fill in the publishable key and the Maps SDK keys for the delivery pin map (`GOOGLE_MAPS_IOS_API_KEY`, `GOOGLE_MAPS_ANDROID_API_KEY`; a build without them has no pin map). On a physical device, use your machine's LAN IP for `EXPO_PUBLIC_API_URL`.
3. Build and open a dev build: `bunx expo run:ios` or `bunx expo run:android`.

## End-to-end flows

Maestro flows live in `.maestro/`. With the backend running (with `GOOGLE_MAPS_API_KEY`) and the dev build open: `maestro test .maestro/add-address-by-search.yaml` (an address at checkout) or `maestro test .maestro/saved-addresses.yaml` (Account → Addresses: add, edit, checkout preselects the default, delete). Each flow signs in a Clerk test buyer (`sign-in.yaml`; a development instance accepts `+clerk_test` emails with code 424242), signing up on the first run. In a dev build, first turn off "Tools button" in the dev menu: the floating button sits over checkout's "Change" and takes its taps.

### Against the network fakes

`purchase-from-two-shops.yaml` (#8) buys from two shops in one checkout: rice from Iya Bisi Foodstuff and a surge protector from Ikeja Gadget Hub, delivered to an address found by search and paid on Paystack's page. It is a wiring smoke test against a backend whose Paystack, Shipbubble and Google address lookup are the integration tests' network fakes, so it moves no money and needs no provider keys. The flows run on the iOS simulator only (the vendor app's flow too): they reach the backend and the fake Paystack's page at `localhost`, which an Android emulator doesn't share with your machine, and the vendor flow answers iOS's own Save Password prompt.

1. `bun run --cwd packages/api e2e:backend`. It drops and recreates the `oja_e2e` database (`E2E_DATABASE_URL`, default the Docker Postgres from `bun run db:up`), migrates and seeds it, starts the fakes on ports 9101 (Paystack), 9102 (Shipbubble) and 9103 (Google) (`E2E_PAYSTACK_PORT`, `E2E_SHIPBUBBLE_PORT`, `E2E_GOOGLE_PORT` to move them), and serves the backend on port 9001 (`E2E_PORT`) with `medusa start` from the source, no build needed. The fake Paystack's page has one Pay button, which posts the signed `charge.success` webhook and returns to the app. Buyers still sign in with Clerk, so `packages/api/.env` needs `CLERK_JWT_KEY` (or `CLERK_SECRET_KEY`); its other provider keys are overridden. When ready it prints the Metro command, with the fresh database's publishable key. Ctrl-C stops the backend and the fakes.
2. In this directory, start Metro with what it printed: `EXPO_PUBLIC_API_URL=http://localhost:9001 EXPO_PUBLIC_PUBLISHABLE_KEY=<printed key> bunx expo start --dev-client`, and open the dev build on it. The app's `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (from `.env`) must belong to the same Clerk development instance as the backend's `CLERK_JWT_KEY`, or the buyer signs in and every signed-in request is refused (401). Turn off "Tools button" in the dev menu, as for the other flows.
3. `maestro test .maestro/purchase-from-two-shops.yaml`.

It leaves a paid order at each shop, which the vendor app's `accept-to-handover.yaml` takes on. Both flows can be run again, buyer then vendor, without restarting the backend: each buyer run places new orders, and each vendor run takes the newest. Restarting it starts from a fresh database, with a new publishable key for Metro. The dev build must match the code: a build older than its native modules crashed opening the pin map (react-native-maps asserting on its props), so rebuild (`bunx expo run:ios`) after pulling native changes.

## Layout

- `app.config.ts`: name, scheme (`oja://`) and bundle id come from `appIdentity` in `@oja/domain`.
- `src/app/`: routes only. Tabs (Home, Search, Cart, Orders, Account) in `(tabs)`; product, seller and checkout stacks and the sign-in modal at the root.
- `src/screens/<name>/`: screens rendered by routes.
- `src/api/`: the Store API client, and per-domain query keys and TanStack Query hooks.
- `src/region/`: resolves the shopping region from the backend and the device's country.
- `src/push/`: once a buyer is signed in, asks for notification permission and registers the device's Expo push token (`POST /store/push-tokens`); sign-out removes it first. Tapping a push opens the screen its `url` names. Uses `expo-notifications`, a native module: rebuild the dev build after pulling it. Pushes need a physical device and `EAS_PROJECT_ID` in `.env` (from `eas init`), plus APNs/FCM credentials in EAS; without them the app runs and gets none.
- `src/config/env.ts`: typed `EXPO_PUBLIC_*` env; the app fails fast if a value is missing.

## Dependencies nothing imports

- `@clerk/expo-native-components`: the native iOS and Android code behind `AuthView` (imported from `@clerk/expo/native-components`). It is an optional peer of `@clerk/expo`, which loads it at runtime and applies its config plugin when it is installed; listing it here is what makes autolinking build it into the app. Without it the app still builds, but sign-in fails at runtime asking for the package. Keep its version in step with `@clerk/expo`.
