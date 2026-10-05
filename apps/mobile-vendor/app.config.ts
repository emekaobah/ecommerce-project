// Relative imports of plain-JS modules: Expo's config loader doesn't transpile workspace TypeScript.
import { appIdentity } from '../../packages/domain/src/app-identity.js';
import withIosSceneLifecycle from '../../packages/expo-plugins/with-ios-scene-lifecycle.js';
import type { ExpoConfig } from 'expo/config';

// Name, scheme and bundle id derive from the product-name constant in @oja/domain.
const { name, slug, scheme, bundleId } = appIdentity('vendor');

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
    'expo-secure-store',
    // Staff scan item barcodes while picking; no video, so no microphone.
    [
      'expo-camera',
      {
        cameraPermission: 'Allow $(PRODUCT_NAME) to use the camera to scan item barcodes while picking orders.',
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    ['expo-splash-screen', { backgroundColor: '#FFFFFF', image: './assets/splash-icon.png', imageWidth: 120 }],
    // Pushes for new orders, the accept deadline and courier pickups (#27).
    'expo-notifications',
    withIosSceneLifecycle,
  ],
  // Expo push tokens are issued per EAS project; without one the app runs but gets no pushes.
  extra: { eas: { projectId: process.env.EAS_PROJECT_ID || undefined } },
  experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
