// Errors, crashes and traces (app start, network) sent to Sentry, shared by the buyer and vendor
// apps (#19, ADR 0013).
import * as Sentry from '@sentry/react-native';
import { useNavigationContainerRef } from 'expo-router';
import { useEffect } from 'react';

// Names traces by the route's file path, e.g. `__root/(app)/index`. On Expo Router 58 that is only
// the app start: the router no longer emits the event Sentry starts navigation spans on (ADR 0013).
const navigation = Sentry.reactNavigationIntegration({ useFullPathsForNavigationRoutes: true });

/**
 * Starts Sentry with the app's DSN; called once, before the root layout renders. Without a DSN,
 * as in local development, nothing is sent. Release and dist come from the native build.
 */
export function initSentry(dsn: string | undefined): void {
  Sentry.init({
    dsn,
    enabled: Boolean(dsn),
    environment: __DEV__ ? 'development' : 'production',
    tracesSampleRate: __DEV__ ? 1 : 0.1,
    integrations: [navigation],
  });
}

export const withSentry = Sentry.wrap;

/**
 * Hands Expo Router's navigation container to Sentry; called by the root layout. Sentry's own
 * Expo Router integration reads router internals that SDK 58 removed, so it finds nothing.
 */
export function useSentryNavigation(): void {
  const container = useNavigationContainerRef();
  useEffect(() => {
    if (container.current) navigation.registerNavigationContainer(container);
  }, [container]);
}

/**
 * Sends a failure the screen words itself to Sentry: never shown, but seen. `where` names it
 * ("Couldn't book the courier"), as `ErrorState` names its own by title.
 */
export function reportError(error: unknown, where: string): void {
  Sentry.captureException(error, { tags: { action_error: where } });
}

/** Reports `error` once each time it changes, as `ErrorState` does; null or undefined reports nothing. */
export function useReportError(error: unknown, where: string): void {
  useEffect(() => {
    if (error) reportError(error, where);
  }, [error, where]);
}
