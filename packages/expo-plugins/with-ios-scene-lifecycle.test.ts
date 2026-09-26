import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { adoptSceneLifecycle } from "./with-ios-scene-lifecycle"

// The SDK 57 prebuild template's AppDelegate, trimmed to the parts the plugin touches.
const template = readFileSync(new URL("./fixtures/AppDelegate.swift", import.meta.url), "utf8")

describe("adoptSceneLifecycle", () => {
  test("hands window creation and React Native startup to a scene delegate", () => {
    const src = adoptSceneLifecycle(template)

    expect(src).toContain("class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {")
    expect(src).not.toContain("startReactNative")
    expect(src).toContain("class SceneDelegate: ExpoAppSceneDelegate {}")
  })

  test("leaves an already adopted AppDelegate unchanged, so prebuild can run again", () => {
    const once = adoptSceneLifecycle(template)

    expect(adoptSceneLifecycle(once)).toBe(once)
  })

  test("fails loudly when the template changes, so the plugin gets reviewed", () => {
    const changed = template.replace("class AppDelegate: ExpoAppDelegate {", "class AppDelegate: NewDelegate {")

    expect(() => adoptSceneLifecycle(changed)).toThrow(/template changed/)
  })
})
