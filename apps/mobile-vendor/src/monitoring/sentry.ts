import * as Sentry from '@sentry/react-native';

import { env } from '@/config/env';

// Crashes and unhandled errors go to Sentry (#19). Without a DSN, as in local development,
// nothing is sent. Release and dist come from the native build.
Sentry.init({
  dsn: env.sentryDsn,
  enabled: Boolean(env.sentryDsn),
  environment: __DEV__ ? 'development' : 'production',
});

export const withSentry = Sentry.wrap;
