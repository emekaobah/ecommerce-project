# 12. One copy of each Expo package in the app bundles

Status: accepted, 2026-10-18 (#9)

## Context

`bunx expo-doctor` fails its duplicate-dependencies check in both Expo apps. It finds same-version copies of `expo`, `expo-constants`, `expo-font`, `expo-linking`, `expo-symbols`, `expo-glass-effect`, `@expo/ui`, `@expo/dom-webview` and `@expo/log-box`, and a `react@18.3.1` beside the apps' `react@19.2.3`. Two instances of a native module's JS, or of React, in one bundle give module registries and contexts that don't match.

Facts that shaped the decision (checked 2026-10-18, Bun 1.4.2, Expo SDK 57):

- Bun's isolated linker makes one copy of a package per set of resolved peers (`node_modules/.bun/<name>@<version>+<peer hash>`). Every Expo copy is the same version. They differ because of peer cycles: `expo` depends on `expo-constants`, `expo-font`, `@expo/dom-webview` and `@expo/log-box`, and each of those has `expo` as a peer. Bun resolves the peer inside the cycle to another `expo` copy, which then needs its own copies of those packages. `expo-router` gets its own `expo-linking`, `@expo/ui` and the rest the same way.
- The `react@18.3.1` belongs to the `@tanstack/react-query` that `@oja/api-client` reaches through `@mercurjs/client`. It resolves its `react` peer from the repo root, where the web panels keep React 18.
- Hoisting is ruled out: the web panels run React 18 and the Expo apps React 19.
- Expo CLI has its own Metro resolver, autolinking module resolution (`experiments.autolinkingModuleResolution`). It resolves `react`, `react-dom`, `react-native`, `react-native-web` and every autolinked native module (all the Expo packages above) to the copy the app itself links. It is on by default when the app is in a workspace. With it turned off, the buyer app's iOS bundle carried three `expo-constants` copies and React 18 next to React 19. With it on, each bundle has one copy of each.
- Native builds already take one copy. Autolinking resolves each native module from the app's own `node_modules`, so the pods and Gradle projects use the app's copy.
- `expo-doctor` (1.21.5) has no setting to exclude packages from its duplicate check. `expo.install.exclude` covers only the version check.

## Decision

The owner chose to keep Bun's isolated linker and force one copy (comment on #9, 2026-10-17): first try root `overrides`, then pin in Metro's resolver only if copies remain.

- **Root `overrides`: not enough.** Pinning all ten packages to their installed versions changed nothing, even after a clean install. Every copy was already the same version, and an override can't break a peer cycle. The overrides were not kept.
- **Pinning in Metro's resolver: enough, using Expo's own resolver.** Both apps set `experiments.autolinkingModuleResolution: true` in `app.config.ts`. It already pins `expo`, `react` and `react-native` (and the other native modules) to each app's own copy. Turning it on explicitly means it does not depend on Expo detecting the workspace. A hand-written `resolver.resolveRequest` would repeat it, so there isn't one.

## Consequences

- Each app's iOS bundle (`expo export`) has one copy of every Expo package, of React and of React Native. The buyer bundle's only other duplicate is `@tanstack/query-core` (5.64.2 for the app, 5.104.0 inside Clerk). It's a real version difference, and the two never share a client.
- `expo-doctor` still reports the duplicate check as failed in both apps, with "Your node_modules folder may be corrupted" advice. That's harmless: neither the bundles nor the native builds use the extra copies. It can't be silenced, so ignore that check and read the rest of the report. Deleting `node_modules` won't clear it.
- A new Expo package with the same cycle will show up in that report too. It is covered as long as it is autolinked (it has native code) or is one of the React packages above. A JS-only package duplicated in the same way would not be pinned. Check the export's source map (`expo export --source-maps`) before trusting a new duplicate.
- If a later Bun links peer cycles to one copy, the duplicate check may start passing. Nothing else here would change.

## Rechecked on Expo SDK 58 (#49, 2026-10-18)

Bun 1.4.2, `expo` 58.0.14, React 19.3.0, React Native 0.88.0, `expo-doctor` 1.21.5.

- `expo-doctor` passes 19 of 20 checks in both apps. The version check passes. Only the duplicate check fails, for the same peer-cycle reason as above: `expo`, `expo-constants`, `expo-font` and `react@18.3.1` in both apps, `expo-glass-effect` and `expo-linking` in the buyer app, and `@expo/dom-webview` and `@expo/log-box` in the vendor app.
- `experiments.autolinkingModuleResolution` still pins them. The iOS exports (`expo export -p ios --source-maps`) carry one copy of every Expo package, of React and of React Native. In the buyer bundle, `expo/internal/async-require-module.js` is listed under the app's `node_modules/expo` symlink and the rest of `expo` under its `.bun` path, but both are the same install. The only real duplicate is still `@tanstack/query-core` (5.64.2 for the app, 5.104.0 inside Clerk).
