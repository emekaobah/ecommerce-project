# 16. The Expo workspaces point `react` at their own React 19 types

Status: accepted, 2026-10-26 (#102)

## Context

`packages/ui` uses Reanimated's `Animated.View` for the top band (#102). Without help, `tsc` rejects its `style` prop: `Property 'style' does not exist on type 'IntrinsicAttributes & Omit<AnimatedProps<Readonly<{}>>, "ref"> …'`. Reanimated's types had been read against React 18's types.

Facts that shaped the decision (checked 2026-10-26, Bun 1.4.2, TypeScript 6.0.3, Expo SDK 58):

- Bun's isolated linker puts each package in `node_modules/.bun/<name>@<version>+<peer hash>/node_modules/<name>` and links next to it only the package's dependencies and peers. TypeScript follows the symlink to that real path and resolves imports from there.
- `react` has no types of its own, so TypeScript looks for `@types/react`. A package that lists it as a peer, like `react-native`, gets the workspace's `@types/react` linked next to it. Most React Native libraries don't list it. Tracing `tsc --traceResolution` in `packages/ui` found `react-native-reanimated`, `react-native-svg`, `react-native-safe-area-context`, `expo-image`, `expo-modules-core`, `expo`, `@sentry/react-native` and `@sentry/react` all resolving `react` to `@types/react@18.3.31`.
- For those packages the search walks up to `node_modules/.bun/node_modules`, the hidden hoist, then to `node_modules`. Both hold the one copy of `@types/react` that Bun picks for the root. It is the root's `devDependencies` entry, `^18.3.2`, for the web panels.
- The repo has two React majors: React 18 for the web panels (`apps/admin`, `apps/vendor`, Mercur's and Medusa's dashboard packages) and React 19 for the Expo apps and their packages (ADR 0012: hoisting is ruled out). Whichever `@types/react` sits at the root, the other side's libraries read the wrong one.
- Tried: moving `@types/react` 18 from the root to `apps/admin` and `apps/vendor`. Bun still hoisted 18, because the web packages ask for it. Then setting the root's `@types/react` to `~19.3.0`, with 18 kept in the two panels. The Expo side type-checked without help, but `apps/admin` broke: `@medusajs/ui`'s `Text`, `Select.Item` and `@medusajs/icons` "cannot be used as a JSX component", since they now read React 19's `ReactNode` while the panel's JSX uses React 18's. The problem only moved to the other side.
- Bun has `hoistPattern` and `publicHoistPattern` but no `packageExtensions`. A library's missing peer can't be added from the repo. Patching eight libraries' `package.json` would be redone on every upgrade, and it isn't clear that Bun reads peers from a patched manifest.
- Keeping `@types/react` out of the hidden hoist leaves those libraries with no React types at all. Under `skipLibCheck` their components quietly become `any`.

## Decision

Keep the root on React 18's types for the web panels. Each workspace that type-checks Expo code (`packages/ui`, `apps/mobile-buyer`, `apps/mobile-vendor`) maps `react` and `react/*` to its own `node_modules/@types/react` with `compilerOptions.paths`. That's 19.3.0, the version its own `package.json` asks for. `paths` applies to every import in the program, library declaration files included, so Reanimated and the rest read React 19 too.

## Consequences

- One `@types/react` (19) in each Expo program, and the web panels keep theirs (18). Neither side breaks the other.
- A new Expo workspace that compiles `@oja/ui` or uses React Native libraries needs the same two `paths` entries. Without them, errors like the one above show up on library components that take children or style.
- Each workspace has to list `@types/react` in its own `devDependencies` so `./node_modules/@types/react` exists. All three do.
- If the web panels move to React 19, or the root stops needing React 18's types, set the root's `@types/react` to 19 and drop the `paths`.
