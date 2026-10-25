// Relative import of a plain-JS module: Expo's config loader doesn't transpile workspace TypeScript.
import { APPLE_TEAM_ID, appIdentity } from '../../packages/domain/src/app-identity.js';
import { fontFiles } from '../../packages/ui/src/fonts.js';
import type { ExpoConfig } from 'expo/config';

// Name, scheme and bundle id derive from the product-name constant in @oja/domain.
const { name, slug, scheme, bundleId } = appIdentity('buyer');

/**
 * Maps SDK keys for the pin map (ADR 0002), baked into the native projects at prebuild. They
 * are Google Cloud keys restricted to the Maps SDK for iOS and for Android and to this app.
 * Only a build needs them, so a missing key warns rather than stopping every Expo command.
 */
function mapsKey(variable: 'GOOGLE_MAPS_IOS_API_KEY' | 'GOOGLE_MAPS_ANDROID_API_KEY'): string | undefined {
  const key = process.env[variable];
  if (!key) console.warn(`Missing ${variable}: a build made now has no delivery pin map. See .env.example.`);
  return key;
}

const config: ExpoConfig = {
  name,
  slug,
  scheme,
  version: '1.0.0',
  orientation: 'portrait',
  // Follows the system's light or dark setting; there's no in-app toggle.
  userInterfaceStyle: 'automatic',
  // Placeholder wordmarks until the design pass supplies the real brand mark.
  icon: './assets/icon.png',
  ios: { bundleIdentifier: bundleId, appleTeamId: APPLE_TEAM_ID },
  android: {
    package: bundleId,
    predictiveBackGestureEnabled: false,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0B5CFF' },
  },
  plugins: [
    'expo-router',
    'expo-localization',
    'expo-secure-store',
    // Native sign-in UI (AuthView). Adds the Sign in with Apple entitlement and needs a dev build.
    ['@clerk/expo', { theme: './clerk-theme.json' }],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#FFFFFF',
        // The light wordmark on the dark page, in the dark theme's text colour (docs/design.md).
        dark: { backgroundColor: '#111113', image: './assets/splash-icon-dark.png' },
        image: './assets/splash-icon.png',
        imageWidth: 120,
      },
    ],
    // Bricolage Grotesque and Manrope, bundled from @oja/ui: one file per weight.
    ['expo-font', { fonts: fontFiles() }],
    ['expo-location', { locationWhenInUsePermission: `${name} uses your location to show shops near you and to find your delivery address.` }],
    // Google's map on both platforms, so the pin map matches the address search's data.
    [
      'react-native-maps',
      {
        iosGoogleMapsApiKey: mapsKey('GOOGLE_MAPS_IOS_API_KEY'),
        androidGoogleMapsApiKey: mapsKey('GOOGLE_MAPS_ANDROID_API_KEY'),
      },
    ],
    // Pushes about the buyer's orders (#27, #28).
    'expo-notifications',
    // Crash reporting (#19). Release builds upload source maps and debug symbols when
    // SENTRY_AUTH_TOKEN is set, and skip the upload otherwise.
    [
      '@sentry/react-native/expo',
      {
        organization: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        disableAutoUpload: !process.env.SENTRY_AUTH_TOKEN,
      },
    ],
  ],
  // Expo push tokens are issued per EAS project; without one the app runs but gets no pushes.
  extra: { eas: { projectId: process.env.EAS_PROJECT_ID || undefined } },
  // Metro resolves react, react-native and every autolinked native module to the copy this app
  // links, though Bun's isolated install keeps same-version copies elsewhere (ADR 0012).
  experiments: { typedRoutes: true, reactCompiler: true, autolinkingModuleResolution: true },
};

export default config;
