# 13. Sentry's navigation container registered by hand on Expo Router 58

Status: accepted, 2026-10-18 (#49)

## Context

Both Expo apps report errors, crashes and traces to Sentry (#19). On SDK 57, `@sentry/react-native` found Expo Router by itself: its default `expoRouterIntegration` and its `wrapExpoRouterErrorBoundary` (applied to every route by `getSentryExpoConfig(..., { autoWrapExpoRouterErrorBoundary: true })` in `metro.config.js`) both read `require('expo-router/build/global-state/router-store')`.

Facts that shaped the decision (checked 2026-10-18 on the iOS 27 simulator, against the `oja-vendor` Sentry project, environment `development`):

- Expo Router 58 has no `build/global-state/router-store`. Sentry's `require` sits in a try/catch, so nothing crashes, but Metro warns that the module can't be resolved, and `expoRouterIntegration` gives up without registering a navigation container. With SDK 58 as it was, the vendor app sent no transactions at all: no app start, no navigation.
- No Sentry release reads the new router. SDK 58 pins `@sentry/react-native` ~8.28.0; 8.29.0, 8.30.0 and 8.31.0 (the latest, 2026-10-15) still require the same path.
- Expo Router 58 still exports `useNavigationContainerRef()`, and registering it with `reactNavigationIntegration` is the setup Sentry documented before `expoRouterIntegration` existed. Its container still emits `state`, but no longer emits `__unsafe_action__`, the event Sentry starts each navigation span on. Router 58 reports dispatched actions only through internal events (`build/global-state/internalNavigationEvents`).

## Decision

Each app's `src/monitoring/sentry.ts` adds `reactNavigationIntegration({ useFullPathsForNavigationRoutes: true })` to `Sentry.init`, and the root layout calls `useSentryNavigation()`, which registers `useNavigationContainerRef()` with it. We stay on 8.28.0, the version SDK 58 lists. We don't patch Sentry or subscribe to the router's internal events.

## Consequences

- App start transactions (`ui.load`) are sent again, named by the route's file path with Sentry's root prefix, e.g. `__root/(app)/index`. With the registration in place and then removed, the same launches sent none.
- Moving between screens creates no navigation transactions or navigation breadcrumbs, because nothing emits `__unsafe_action__`. Network spans and errors are still reported.
- Errors caught by a route's `ErrorBoundary` are still captured, but `wrapExpoRouterErrorBoundary` can't read the current route, so those events have no `route.name` / `route.path` tags.
- Metro keeps warning that `expo-router/build/global-state/router-store` can't be resolved. The warning is harmless.
- Follow-up: when a Sentry release supports Expo Router 58 (its changelog mentions the router, or `dist/js/tracing/expoRouterStore.js` stops requiring `router-store`), upgrade to the version Expo's `bundledNativeModules` lists. Then remove `useSentryNavigation()` and the integration added by hand, and check that navigation transactions and error boundary route tags come back.
