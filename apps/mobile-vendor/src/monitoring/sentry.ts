import * as Sentry from '@sentry/react-native';

import { env } from '@/config/env';

// Errors, crashes and traces (app start, navigation, network) go to Sentry (#19). Without a
// DSN, as in local development, nothing is sent. Release and dist come from the native build.
Sentry.init({
  dsn: env.sentryDsn,
  enabled: Boolean(env.sentryDsn),
  environment: __DEV__ ? 'development' : 'production',
  tracesSampleRate: __DEV__ ? 1 : 0.1,
});

export const withSentry = Sentry.wrap;
