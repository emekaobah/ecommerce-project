// iOS 27 refuses to launch apps that don't adopt the UIKit scene life cycle, and the
// SDK 57 prebuild template still starts React Native from the app delegate. Expo ships
// `ExpoAppSceneDelegate` for this; this plugin wires it in on every prebuild.
// Remove it once the SDK template adopts scenes itself.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

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

function withSceneDelegate(config) {
  return withAppDelegate(config, (config) => {
    let src = config.modResults.contents;
    if (config.modResults.language !== 'swift') {
      throw new Error('with-ios-scene-lifecycle: expected a Swift AppDelegate');
    }
    if (src.includes('class SceneDelegate')) return config;

    const declaration = 'class AppDelegate: ExpoAppDelegate {';
    if (!src.includes(declaration) || !src.includes(START_IN_APP_DELEGATE)) {
      // Fail loudly: the template changed, so check whether this plugin is still needed.
      throw new Error('with-ios-scene-lifecycle: AppDelegate template changed; review this plugin');
    }
    src = src
      .replace(declaration, 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {')
      .replace(START_IN_APP_DELEGATE, '');
    config.modResults.contents = src + SCENE_DELEGATE;
    return config;
  });
}

function withSceneManifest(config) {
  return withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
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
    return config;
  });
}

module.exports = function withIosSceneLifecycle(config) {
  return withSceneManifest(withSceneDelegate(config));
};
