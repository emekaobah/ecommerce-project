// Relative imports of plain-JS modules: Expo's config loader doesn't transpile workspace TypeScript.
import { appIdentity } from '../../packages/domain/src/app-identity.js';
import withIosSceneLifecycle from '../../packages/expo-plugins/with-ios-scene-lifecycle.js';
import type { ExpoConfig } from 'expo/config';

// Name, scheme and bundle id derive from the product-name constant in @oja/domain.
const { name, slug, scheme, bundleId } = appIdentity('buyer');

/**
 * Maps SDK keys for the pin map (ADR 0002), baked into the native projects at prebuild. They
 * are Google Cloud keys restricted to the Maps SDK for iOS and for Android and to this app.
 */
function mapsKey(variable: 'GOOGLE_MAPS_IOS_API_KEY' | 'GOOGLE_MAPS_ANDROID_API_KEY'): string {
  const key = process.env[variable];
  if (!key) throw new Error(`Missing ${variable}. Copy .env.example to .env and fill it in.`);
  return key;
}

const config: ExpoConfig = {
  name,
  slug,
  scheme,
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  // Placeholder wordmarks until the design pass supplies the real brand mark.
  icon: './assets/icon.png',
  ios: { bundleIdentifier: bundleId },
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
    ['expo-splash-screen', { backgroundColor: '#FFFFFF', image: './assets/splash-icon.png', imageWidth: 120 }],
    ['expo-location', { locationWhenInUsePermission: `${name} uses your location to find your delivery address.` }],
    // Google's map on both platforms, so the pin map matches the address search's data.
    [
      'react-native-maps',
      {
        iosGoogleMapsApiKey: mapsKey('GOOGLE_MAPS_IOS_API_KEY'),
        androidGoogleMapsApiKey: mapsKey('GOOGLE_MAPS_ANDROID_API_KEY'),
      },
    ],
    withIosSceneLifecycle,
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
