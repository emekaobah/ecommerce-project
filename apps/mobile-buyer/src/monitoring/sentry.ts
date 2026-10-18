import * as Sentry from '@sentry/react-native';
import { useNavigationContainerRef } from 'expo-router';
import { useEffect } from 'react';

import { env } from '@/config/env';

// Names traces by the route's file path, e.g. `__root/(tabs)/index`. On Expo Router 58 that is only
// the app start: the router no longer emits the event Sentry starts navigation spans on (ADR 0013).
const navigation = Sentry.reactNavigationIntegration({ useFullPathsForNavigationRoutes: true });

// Errors, crashes and traces (app start, network) go to Sentry (#19). Without a
// DSN, as in local development, nothing is sent. Release and dist come from the native build.
Sentry.init({
  dsn: env.sentryDsn,
  enabled: Boolean(env.sentryDsn),
  environment: __DEV__ ? 'development' : 'production',
  tracesSampleRate: __DEV__ ? 1 : 0.1,
  integrations: [navigation],
});

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
