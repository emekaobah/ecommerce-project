// iOS 27 refuses to launch apps that don't adopt the UIKit scene life cycle, and the
// SDK 57 prebuild template still starts React Native from the app delegate. Expo ships
// `ExpoAppSceneDelegate` for this; this plugin wires it in on every prebuild.
// Remove it once the SDK template adopts scenes itself.
//
// Plain JavaScript because each app's app.config.ts imports it, and Expo's config loader
// doesn't transpile workspace TypeScript.

const START_IN_APP_DELEGATE = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`;

const SCENE_DELEGATE = `
// Creates the window and starts React Native once UIKit connects a scene.
class SceneDelegate: ExpoAppSceneDelegate {}
`;

const DECLARATION = 'class AppDelegate: ExpoAppDelegate {';

/** Rewrites the template's Swift AppDelegate so a scene delegate starts React Native. */
function adoptSceneLifecycle(src) {
  if (src.includes('class SceneDelegate')) return src;
  if (!src.includes(DECLARATION) || !src.includes(START_IN_APP_DELEGATE)) {
    // Fail loudly: the template changed, so check whether this plugin is still needed.
    throw new Error('with-ios-scene-lifecycle: AppDelegate template changed; review this plugin');
  }
  const adopted = src
    .replace(DECLARATION, 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {')
    .replace(START_IN_APP_DELEGATE, '');
  return adopted + SCENE_DELEGATE;
}

const SCENE_MANIFEST = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: 'Default Configuration',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
      },
    ],
  },
};

// Resolved from the app rather than this package: Bun's isolated linker gives each app
// its own `expo`, and this package deliberately has none (see #44).
function configPlugins(config) {
  const projectRoot = config._internal?.projectRoot ?? process.cwd();
  return require(require.resolve('expo/config-plugins', { paths: [projectRoot] }));
}

function withIosSceneLifecycle(config) {
  const { withAppDelegate, withInfoPlist } = configPlugins(config);
  config = withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') {
      throw new Error('with-ios-scene-lifecycle: expected a Swift AppDelegate');
    }
    config.modResults.contents = adoptSceneLifecycle(config.modResults.contents);
    return config;
  });
  return withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = SCENE_MANIFEST;
    return config;
  });
}

module.exports = withIosSceneLifecycle;
module.exports.adoptSceneLifecycle = adoptSceneLifecycle;
