// Relative import of a plain-JS module: Expo's config loader doesn't transpile workspace TypeScript.
import { APPLE_TEAM_ID, appIdentity } from '../../packages/domain/src/app-identity.js';
import { NEW_ORDER_ALARM } from '../../packages/domain/src/new-order-alarm.js';
import { fontFiles } from '../../packages/ui/src/fonts.js';
import type { ExpoConfig } from 'expo/config';

// Name, scheme and bundle id derive from the product-name constant in @oja/domain.
const { name, slug, scheme, bundleId } = appIdentity('vendor');

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
  ios: {
    bundleIdentifier: bundleId,
    appleTeamId: APPLE_TEAM_ID,
    // A new order's push is time-sensitive, breaking through Focus (#71); not a critical alert.
    entitlements: { 'com.apple.developer.usernotifications.time-sensitive': true },
  },
  android: {
    package: bundleId,
    predictiveBackGestureEnabled: false,
    // Lets the member allow the new-order alarm through Do Not Disturb from Settings (#83).
    permissions: ['android.permission.ACCESS_NOTIFICATION_POLICY'],
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
    // Pushes for new orders, the accept deadline and courier pickups (#27). A new order rings
    // Oja's alarm, bundled here (#71).
    ['expo-notifications', { sounds: [NEW_ORDER_ALARM.soundAsset] }],
    // The new-order takeover loops the alarm while the app is open (#83). Playback only, in the
    // foreground: no microphone, no background audio.
    [
      'expo-audio',
      { microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: false },
    ],
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
