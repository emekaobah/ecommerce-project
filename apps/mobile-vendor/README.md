# Oja vendor app

Expo Router app for shop members. Architecture: [ADR 0001](../../docs/adr/0001-mobile-app-architecture.md).

## Run

1. Start the backend (`bun run dev` at the repo root).
2. `cp .env.example .env`. On a physical device, use your machine's LAN IP for `EXPO_PUBLIC_API_URL`.
3. Build and open a dev build: `bunx expo run:ios` or `bunx expo run:android`.
4. Sign in as a seeded shop member.

## End-to-end flows

Maestro flows live in `.maestro/`. `pick-and-pack.yaml` signs in as the seeded grocery owner (`sign-in.yaml`), accepts the newest new order, picks it (leaving the checklist and coming back keeps the ticks) and packs it. Each run needs a new order for the grocery shop, which `bun run --cwd packages/api demo:order` places without a checkout (unpaid, so don't reject it). With the backend and the dev build running: `maestro test .maestro/pick-and-pack.yaml`. Scanning isn't covered: the simulator has no camera.

## Layout

- `app.config.ts`: name, scheme (`ojavendor://`) and bundle id come from `appIdentity` in `@oja/domain`. The iOS scene life cycle plugin is shared with the buyer app from `@oja/expo-plugins`.
- `src/app/`: routes only. `(auth)` holds sign-in and the shop picker; `(app)` holds the order list, settings (current shop, switch shop, sign out) and the switch-shop picker. The root layout guards each group on the session.
- `src/screens/<name>/`: screens rendered by routes.
- `src/screens/pick/`: the picking checklist, barcode scanner and packed confirmation. The scanner uses `expo-camera`, a native module: rebuild the dev build after pulling it. The iOS simulator has no camera, so scan on a device; ticking by hand works anywhere.
- `src/session/`: the member JWT and current seller id, persisted in SecureStore, so the chosen shop survives restarts. The splash screen stays up until they are read. A member of one shop goes straight in; a member of several picks a shop after signing in. Switching shops empties the query cache. Sign-out and any 401 clear them and return to sign-in. A member removed from the current shop is moved to the only shop left, back to the shop picker, or signed out if no shop is left.
- `src/push/`: once a member is signed in to a shop, asks for notification permission and registers the device's Expo push token (`POST /vendor/push-tokens`); sign-out removes it. The member's devices get a push for each new order, an order two hours from its accept deadline, and a courier pickup booked, in every shop they belong to. Tapping one opens the order, switching to its shop first; a push arriving while the app is open refreshes the orders. Uses `expo-notifications`, a native module: rebuild the dev build after pulling it. Pushes need a physical device and `EAS_PROJECT_ID` in `.env` (from `eas init`), plus APNs/FCM credentials in EAS; without them the app runs and gets none.
- `src/api/`: the Vendor API client, and per-domain query keys and TanStack Query hooks.
- `src/config/env.ts`: typed `EXPO_PUBLIC_*` env; the app fails fast if a value is missing.

## Staff

Staff are invited by the shop's owner in the web vendor panel (Settings → Users → Invite, role **Order Management** for fulfilment staff, **Seller Administration** for managers). The API emails the invitee the panel's accept link, built from `MERCUR_VENDOR_URL`; until an email provider is configured, the local notification provider logs the email, link included, in the API's output. After accepting, staff sign in to this app with the same email and password. Order Management can work orders but can't reach payouts, offers or price lists.
