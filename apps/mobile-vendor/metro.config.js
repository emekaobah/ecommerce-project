// Expo's default Metro config, plus the debug IDs Sentry matches source maps by (#19), and
// Expo Router's per-route ErrorBoundary wrapped so errors it catches still reach Sentry.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname, { autoWrapExpoRouterErrorBoundary: true });
