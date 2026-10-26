/**
 * The app's appearance (#102): System follows the phone's light or dark setting, Light and Dark
 * hold whatever the phone is set to. A setting of this phone, not of the account, so it outlives
 * sign-out and guests have it too.
 */
export type AppearanceChoice = "system" | "light" | "dark"

/** What React Native's `Appearance.setColorScheme` takes: `unspecified` hands the theme back to the phone. */
export type ColorSchemeChoice = "light" | "dark" | "unspecified"

/** Where the choice is kept. Reads are synchronous so it applies before the first screen draws. */
export type AppearanceStorage = {
  read: (key: string) => string | null
  write: (key: string, value: string) => Promise<void>
}

export type AppearanceStore = {
  get: () => AppearanceChoice
  subscribe: (listener: () => void) => () => void
  /** Reads the kept choice and applies it; anything missing or unreadable is System. */
  restore: () => void
  /** Applies the choice at once and keeps it; rejects, with the choice as it was, when the phone can't keep it. */
  choose: (next: AppearanceChoice) => Promise<void>
}

const KEY = "oja.appearance"

const schemeFor = (choice: AppearanceChoice): ColorSchemeChoice => (choice === "system" ? "unspecified" : choice)

const parse = (stored: string | null): AppearanceChoice => (stored === "light" || stored === "dark" ? stored : "system")

function readKept(storage: AppearanceStorage): AppearanceChoice {
  try {
    return parse(storage.read(KEY))
  } catch {
    return "system"
  }
}

export function createAppearanceStore({
  storage,
  applyColorScheme,
}: Readonly<{ storage: AppearanceStorage; applyColorScheme: (scheme: ColorSchemeChoice) => void }>): AppearanceStore {
  let choice: AppearanceChoice = "system"
  const listeners = new Set<() => void>()
  const set = (next: AppearanceChoice) => {
    choice = next
    applyColorScheme(schemeFor(next))
    listeners.forEach((listener) => listener())
  }

  return {
    get: () => choice,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    restore: () => set(readKept(storage)),
    async choose(next) {
      const previous = choice
      set(next)
      try {
        await storage.write(KEY, next)
      } catch (error) {
        set(previous)
        throw error
      }
    },
  }
}
