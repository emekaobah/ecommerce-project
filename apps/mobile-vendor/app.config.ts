// Relative import of a plain-JS module: Expo's config loader doesn't transpile workspace TypeScript.
import { appIdentity } from '../../packages/domain/src/app-identity.js';
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
    // Staff scan item barcodes while picking and photograph products they quick-add; no video, so no microphone.
    [
      'expo-camera',
      {
        cameraPermission:
          'Allow $(PRODUCT_NAME) to use the camera to scan barcodes while picking orders and to photograph products you add.',
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    ['expo-splash-screen', { backgroundColor: '#FFFFFF', image: './assets/splash-icon.png', imageWidth: 120 }],
    // Pushes for new orders, the accept deadline and courier pickups (#27).
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
