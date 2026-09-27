// Relative imports of plain-JS modules: Expo's config loader doesn't transpile workspace TypeScript.
import { appIdentity } from '../../packages/domain/src/app-identity.js';
import withIosSceneLifecycle from '../../packages/expo-plugins/with-ios-scene-lifecycle.js';
import type { ExpoConfig } from 'expo/config';

// Name, scheme and bundle id derive from the product-name constant in @oja/domain.
const { name, slug, scheme, bundleId } = appIdentity('buyer');

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
    withIosSceneLifecycle,
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
