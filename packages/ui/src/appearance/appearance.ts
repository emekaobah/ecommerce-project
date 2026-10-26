import * as SecureStore from "expo-secure-store"
import { useSyncExternalStore } from "react"
import { Appearance } from "react-native"
import { createAppearanceStore, type AppearanceChoice } from "./appearance-store"

// One store per app, kept in SecureStore, whose synchronous read lets the root layout apply the
// choice before the first screen draws. `Appearance.setColorScheme` sets the whole app's style,
// so `useColorScheme()` (and with it `ThemeProvider`) and the native parts switch together.
const store = createAppearanceStore({
  storage: { read: (key) => SecureStore.getItem(key), write: (key, value) => SecureStore.setItemAsync(key, value) },
  applyColorScheme: (scheme) => Appearance.setColorScheme(scheme),
})

/** Applies the phone's kept choice. Each app's root layout calls it once, at module load. */
export const restoreAppearance = store.restore

/** Applies the choice at once and keeps it; rejects, with the choice as it was, when the phone can't keep it. */
export const chooseAppearance = store.choose

export function useAppearance(): AppearanceChoice {
  return useSyncExternalStore(store.subscribe, store.get)
}

/** The choices in the order the sheet lists them, System first: it is the default. */
export const APPEARANCE_CHOICES: readonly AppearanceChoice[] = ["system", "light", "dark"]

/** How the Appearance row and sheet name each choice. */
export const appearanceLabel: Record<AppearanceChoice, string> = { system: "System", light: "Light", dark: "Dark" }
