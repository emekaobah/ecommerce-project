// Expo's default Metro config, plus the debug IDs Sentry matches source maps by (#19).
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
