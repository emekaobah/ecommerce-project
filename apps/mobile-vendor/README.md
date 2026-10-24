# Oja vendor app

Expo Router app for shop members. Architecture: [ADR 0001](../../docs/adr/0001-mobile-app-architecture.md).

## Run

1. Start the backend (`bun run dev` at the repo root).
2. `cp .env.example .env`. On a physical device, use your machine's LAN IP for `EXPO_PUBLIC_API_URL`.
3. Build and open a dev build: `bunx expo run:ios` or `bunx expo run:android`.
4. Sign in as a seeded shop member.

## End-to-end flows

Maestro flows live in `.maestro/`. `pick-and-pack.yaml` signs in as the seeded grocery owner (`sign-in.yaml`), accepts the newest new order, picks it (leaving the checklist and coming back keeps the ticks) and packs it. Each run needs a new order for the grocery shop, which `bun run --cwd packages/api demo:order` places without a checkout (unpaid, so don't reject it). With the backend and the dev build running: `maestro test .maestro/pick-and-pack.yaml`. Scanning isn't covered: the simulator has no camera. `quick-add.yaml` signs in as the grocery shop's staff member, types the seeded power bank's barcode and adds it to the shop; run again, it finds it already in the shop. Proposing a product the catalogue lacks needs a photo, so it is checked on a device.

### Against the network fakes

`accept-to-handover.yaml` (#8) signs in as the grocery shop's staff member and takes the newest new order all the way to the courier: accept, pick, pack, book its courier label, and hand it over once the courier confirms the pickup. It is a wiring smoke test against the e2e backend, whose Shipbubble fake confirms each pickup a few seconds after its label is booked (the order shows it within a minute, when it refreshes; the flow waits up to 150 seconds). Like the buyer's, it runs on the iOS simulator only. It needs a paid order with a courier quote, which `demo:order` doesn't give, so run the buyer app's `purchase-from-two-shops.yaml` first, against the same backend (see the buyer app's README):

1. `bun run --cwd packages/api e2e:backend`, left running from the buyer flow.
2. In this directory: `EXPO_PUBLIC_API_URL=http://localhost:9001 bunx expo start --dev-client` (one Metro at a time: stop the buyer's first), and open the dev build on it. In the dev menu, turn off "Tools button": the floating button can sit over the order screen's buttons and take their taps.
3. `maestro test .maestro/accept-to-handover.yaml`.

To run it again, run the buyer flow again first (no backend restart needed): each run takes the newest new order, and needs one with a courier quote.

## Layout

- `app.config.ts`: name, scheme (`ojavendor://`) and bundle id come from `appIdentity` in `@oja/domain`.
- `src/app/`: routes only. `(auth)` holds sign-in and the shop picker; `(app)` holds the order list, settings (current shop, switch shop, sign out) and the switch-shop picker. The root layout guards each group on the session.
- `src/screens/<name>/`: screens rendered by routes.
- `src/screens/pick/`: the picking checklist, barcode scanner and packed confirmation. The scanner uses `expo-camera`, a native module: rebuild the dev build after pulling it. The iOS simulator has no camera, so scan on a device; ticking by hand works anywhere.
- `src/screens/quick-add/`: quick-add (#38, [ADR 0006](../../docs/adr/0006-quick-add-permissions.md)), opened by **Add product** on the order list. Scan (or type) a barcode; a catalogue product needs the shop's price and stock, an unknown one also a photo and its name, and goes to the catalogue's review. A product the shop already sells is shown but can't be changed here. The photo is shrunk to 1600px JPEG before upload with `expo-image-manipulator`, a native module: rebuild the dev build after pulling it.
- `src/session/`: the member JWT and current seller id, persisted in SecureStore, so the chosen shop survives restarts. The splash screen stays up until they are read. A member of one shop goes straight in; a member of several picks a shop after signing in. Switching shops empties the query cache. Sign-out and any 401 clear them and return to sign-in. A member removed from the current shop is moved to the only shop left, back to the shop picker, or signed out if no shop is left.
- `src/push/`: once a member is signed in to a shop, asks for notification permission and registers the device's Expo push token (`POST /vendor/push-tokens`); sign-out removes it. The member's devices get a push for each new order, an order two hours from its accept deadline, and a courier pickup booked, in every shop they belong to. Tapping one opens the order, switching to its shop first; a push arriving while the app is open refreshes the orders. Uses `expo-notifications`, a native module: rebuild the dev build after pulling it. Pushes need a physical device and `EAS_PROJECT_ID` in `.env`, plus APNs/FCM credentials in EAS; without them the app runs and gets none. The Expo project is `@emekaobah/oja-vendor` (`EAS_PROJECT_ID=dafb359c-2156-4944-8715-67cbfde5eca8`). `eas init` can't write the ID into the dynamic `app.config.ts`, so it lives in `.env`, and Metro must be restarted after setting it (a dev build reads it from Metro's manifest). eas-cli doesn't load `.env`: run it as `EAS_PROJECT_ID=… npx eas-cli credentials -p ios`. iOS push uses the team's APNs key (team HP5MVM38V6), shared by both apps.
- `src/api/`: the Vendor API client, and per-domain query keys and TanStack Query hooks.
- `src/config/env.ts`: typed `EXPO_PUBLIC_*` env; the app fails fast if a value is missing.

## Staff

Staff are invited by the shop's owner in the web vendor panel (Settings → Users → Invite, role **Order Management** for fulfilment staff, **Seller Administration** for managers). The API emails the invitee the panel's accept link, built from `MERCUR_VENDOR_URL`; until an email provider is configured, the local notification provider logs the email, link included, in the API's output. After accepting, staff sign in to this app with the same email and password. Order Management can work orders but can't reach payouts, offers or price lists. The one exception is quick-add: staff can add a product the shop doesn't sell yet, never change one it does, and the owner sees who added each offer on its page in the web vendor panel.
