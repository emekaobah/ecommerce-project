import type { ConfigPlugin } from "expo/config-plugins"

/** Starts React Native from a UIKit scene delegate, which iOS 27 requires. */
declare const withIosSceneLifecycle: ConfigPlugin & {
  /** Rewrites the template's Swift AppDelegate so a scene delegate starts React Native. */
  adoptSceneLifecycle(src: string): string
}

export = withIosSceneLifecycle
