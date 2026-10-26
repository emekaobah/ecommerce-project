import { createKeptValue, type KeptValueStorage } from "../storage/kept-value"

/**
 * The app's appearance (#102): System follows the phone's light or dark setting, Light and Dark
 * hold whatever the phone is set to. A setting of this phone, not of the account, so it outlives
 * sign-out and guests have it too.
 */
export type AppearanceChoice = "system" | "light" | "dark"

/** What React Native's `Appearance.setColorScheme` takes: `unspecified` hands the theme back to the phone. */
export type ColorSchemeChoice = "light" | "dark" | "unspecified"

/** Where the choice is kept. Reads are synchronous so it applies before the first screen draws. */
export type AppearanceStorage = KeptValueStorage & {
  read: (key: string) => string | null
}

export type AppearanceStore = {
  get: () => AppearanceChoice
  subscribe: (listener: () => void) => () => void
  /** Reads the kept choice and applies it; anything missing or unreadable is System. */
  restore: () => void
  /**
   * Applies the choice at once and keeps it; rejects when the phone can't keep it, and the choice
   * goes back to what the phone holds unless another was made after it.
   */
  choose: (next: AppearanceChoice) => Promise<void>
}

const KEY = "oja.appearance"

const schemeFor = (choice: AppearanceChoice): ColorSchemeChoice => (choice === "system" ? "unspecified" : choice)

const parse = (stored: string): AppearanceChoice => (stored === "light" || stored === "dark" ? stored : "system")

function readKept(storage: AppearanceStorage): string | null {
  try {
    return storage.read(KEY)
  } catch {
    return null
  }
}

export function createAppearanceStore({
  storage,
  applyColorScheme,
}: Readonly<{ storage: AppearanceStorage; applyColorScheme: (scheme: ColorSchemeChoice) => void }>): AppearanceStore {
  const choice = createKeptValue<AppearanceChoice>({ key: KEY, initial: "system", codec: { parse, stringify: (c) => c }, storage })
  // Every change the app sees, the phone's theme follows, a failed choice going back included.
  choice.subscribe(() => applyColorScheme(schemeFor(choice.get())))

  return {
    get: choice.get,
    subscribe: choice.subscribe,
    restore: () => choice.load(readKept(storage)),
    choose: choice.save,
  }
}
