# 1. Mobile app architecture

Status: accepted, 2026-09-26 (#6)

## Context

The buyer (`apps/mobile-buyer`) and vendor (`apps/mobile-vendor`) Expo apps started from the default Expo Router template in the walking skeleton. Before the UI slices begin, both apps need one set of conventions for layout, navigation, server state, auth, styling, config and testing, so every slice builds the same way.

## Decisions

### Layout

Standard Expo layout in each app:

- `src/app/` holds routes only. A route file renders a screen and does nothing else.
- `src/screens/<name>/` holds the screen: component, colocated styles, hooks it alone uses.
- `src/components/` holds UI reused across screens in that app. UI shared by both apps lives in `@oja/ui`.
- Styles and tests sit next to the code they cover.

### Buyer navigation

- Guests can browse. Auth is required only for checkout, orders, wishlist and reviews, enforced with protected route groups.
- Tabs: Home / Search / Cart / Orders / Account.
- Stacks pushed over the tabs: product, seller (shop) and checkout.
- Sign-in is a modal, so a guest returns to where they were.

### Vendor navigation

- `(auth)` group: sign-in → shop picker (a member can belong to several shops).
- `(app)` group: order list → order stack (accept → pick → pack → label → handover).
- The root layout keeps the splash screen up until the persisted session is hydrated, so the first frame is already the right group.

### Server and client state

- TanStack Query over `@oja/api-client` is the only server-state store. Each app defines per-domain hooks (`useProducts`, `useOrder`, …) and a query-key factory per domain.
- React context only for small, app-wide client state: session, region, current seller.
- No Redux or Zustand.
- Every data screen designs four states: loading, error, empty and content. `@oja/ui` provides `LoadingState`, `ErrorState` and `EmptyState`.

### Auth

- `@oja/api-client` takes getters, not fixed headers. The token and seller id are read on every request, so a session can change without rebuilding clients.
- Buyer: Clerk. The Clerk session token is fetched per request (`getToken`); guests send none.
- Vendor: member JWT and current seller id kept in SecureStore. Any 401 signs the member out (`onUnauthorized`).
- The buyer's cart id is persisted on the device and survives sign-in.

### Styling

- `StyleSheet` plus tokens from `@oja/ui`. No NativeWind.
- `@expo/ui` for native controls (sheets, pickers, toggles).
- Code is the design system's source of truth. The design pass changes token values, not component APIs.
- Two themes: `buyerTheme` (clean retail, monochrome per `docs/design.md`) and `vendorTheme` (same system, high contrast, larger type and touch targets, state-coloured chips). Status chips always pair a symbol and a label with colour.

### Config

- A product-name constant drives each app's name, deep-link scheme and bundle id (via `app.config.ts`).
- Env is typed `EXPO_PUBLIC_*`, parsed once at startup, and fails fast when a value is missing.
- Each app has its own deep-link scheme.

### Domain helpers

`@oja/domain` holds pure, platform-free rules both apps share:

- Money is formatted from a currency code via `Intl`. No currency is hardcoded.
- Address and phone fields come from per-country config (NG: state + LGA, `+234` numbers).

### Testing

- `@oja/domain` and `@oja/api-client` have unit tests (`bun test`).
- Business rules are tested at the backend HTTP seam (Medusa integration tests).
- Each app gets Maestro E2E flows. There is no app component-test suite.

## Consequences

- Slices add screens and hooks, not new state libraries or styling systems.
- The apps depend on `@oja/ui`, `@oja/domain` and `@oja/api-client`. These packages must pin the same `react` and `react-native` versions as the apps so the monorepo resolves a single copy.
- Without component tests, UI regressions are caught by Maestro flows and review. Keep logic out of components and in `@oja/domain` or the backend, where it is tested.
