# Oja vendor app

Expo Router app for shop members. Architecture: [ADR 0001](../../docs/adr/0001-mobile-app-architecture.md).

## Run

1. Start the backend (`bun run dev` at the repo root).
2. `cp .env.example .env`. On a physical device, use your machine's LAN IP for `EXPO_PUBLIC_API_URL`.
3. Build and open a dev build: `bunx expo run:ios` or `bunx expo run:android`.
4. Sign in as a seeded shop member.

## Layout

- `app.config.ts`: name, scheme (`ojavendor://`) and bundle id come from `appIdentity` in `@oja/domain`. The iOS scene life cycle plugin is shared with the buyer app from `@oja/expo-plugins`.
- `src/app/`: routes only. `(auth)` holds sign-in; `(app)` holds the order list. The root layout guards each group on the session.
- `src/screens/<name>/`: screens rendered by routes.
- `src/session/`: the member JWT and current seller id, persisted in SecureStore. The splash screen stays up until they are read. Sign-out and any 401 clear them and return to sign-in.
- `src/api/`: the Vendor API client, and per-domain query keys and TanStack Query hooks.
- `src/config/env.ts`: typed `EXPO_PUBLIC_*` env; the app fails fast if a value is missing.
