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
  ios: { bundleIdentifier: bundleId },
  android: { package: bundleId, predictiveBackGestureEnabled: false },
  plugins: [
    'expo-router',
    'expo-localization',
    ['expo-splash-screen', { backgroundColor: '#FFFFFF' }],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
