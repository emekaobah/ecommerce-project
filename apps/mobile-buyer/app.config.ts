// Relative import of the plain-JS module: Expo's config loader doesn't transpile workspace TypeScript.
import { appIdentity } from '../../packages/domain/src/app-identity.js';
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
    ['expo-splash-screen', { backgroundColor: '#FFFFFF', image: './assets/splash-icon.png', imageWidth: 120 }],
    './plugins/with-ios-scene-lifecycle',
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
