# Oja vendor app

Expo Router app for shop members. Architecture: [ADR 0001](../../docs/adr/0001-mobile-app-architecture.md).

## Run

1. Start the backend (`bun run dev` at the repo root).
2. `cp .env.example .env`. On a physical device, use your machine's LAN IP for `EXPO_PUBLIC_API_URL`.
3. Build and open a dev build: `bunx expo run:ios` or `bunx expo run:android`.
4. Sign in as a seeded shop member.

## Layout

- `app.config.ts`: name, scheme (`ojavendor://`) and bundle id come from `appIdentity` in `@oja/domain`. The iOS scene life cycle plugin is shared with the buyer app from `@oja/expo-plugins`.
- `src/app/`: routes only. `(auth)` holds sign-in and the shop picker; `(app)` holds the order list, settings (current shop, switch shop, sign out) and the switch-shop picker. The root layout guards each group on the session.
- `src/screens/<name>/`: screens rendered by routes.
- `src/session/`: the member JWT and current seller id, persisted in SecureStore, so the chosen shop survives restarts. The splash screen stays up until they are read. A member of one shop goes straight in; a member of several picks a shop after signing in. Switching shops empties the query cache. Sign-out and any 401 clear them and return to sign-in. A member removed from the current shop is moved to the only shop left, back to the shop picker, or signed out if no shop is left.
- `src/api/`: the Vendor API client, and per-domain query keys and TanStack Query hooks.
- `src/config/env.ts`: typed `EXPO_PUBLIC_*` env; the app fails fast if a value is missing.

## Staff

Staff are invited by the shop's owner in the web vendor panel (Settings → Users → Invite, role **Order Management** for fulfilment staff, **Seller Administration** for managers). The API emails the invitee the panel's accept link, built from `MERCUR_VENDOR_URL`; until an email provider is configured, the local notification provider logs the email, link included, in the API's output. After accepting, staff sign in to this app with the same email and password. Order Management can work orders but can't reach payouts, offers or price lists.
