import { describe, expect, test } from "bun:test"
import { createAppearanceStore, type AppearanceStorage, type ColorSchemeChoice } from "./appearance-store"

/** A phone's storage held in a map, which can be made to refuse reads or writes, or to hold a write until told. */
function phone(stored: Record<string, string> = {}) {
  const kept = new Map(Object.entries(stored))
  const applied: ColorSchemeChoice[] = []
  let failWrites = false
  let failReads = false
  const held = new Map<string, Promise<void>>()
  const storage: AppearanceStorage = {
    read: (key) => {
      if (failReads) throw new Error("keychain locked")
      return kept.get(key) ?? null
    },
    write: async (key, value) => {
      await held.get(value)
      if (failWrites) throw new Error("keychain full")
      kept.set(key, value)
    },
    remove: async (key) => {
      kept.delete(key)
    },
  }
  return {
    kept,
    applied,
    breakWrites: () => (failWrites = true),
    breakReads: () => (failReads = true),
    /** Holds the phone's write of `value` until it is failed or kept. */
    holdWrite(value: string) {
      let release: (error?: Error) => void = () => undefined
      held.set(
        value,
        new Promise<void>((resolve, reject) => {
          release = (error) => (error ? reject(error) : resolve())
        }),
      )
      return { fail: () => release(new Error("keychain busy")), keep: () => release() }
    },
    store: () => createAppearanceStore({ storage, applyColorScheme: (scheme) => applied.push(scheme) }),
  }
}

describe("restoring the appearance at launch", () => {
  test("follows the phone when nothing was chosen", () => {
    const p = phone()
    const store = p.store()
    store.restore()
    expect(store.get()).toBe("system")
    expect(p.applied).toEqual(["unspecified"])
  })

  test("applies the choice kept on the phone", () => {
    const p = phone({ "oja.appearance": "dark" })
    const store = p.store()
    store.restore()
    expect(store.get()).toBe("dark")
    expect(p.applied).toEqual(["dark"])
  })

  test("follows the phone when what was kept isn't a choice it knows", () => {
    const p = phone({ "oja.appearance": "sepia" })
    const store = p.store()
    store.restore()
    expect(store.get()).toBe("system")
    expect(p.applied).toEqual(["unspecified"])
  })

  test("follows the phone when its storage can't be read", () => {
    const p = phone({ "oja.appearance": "dark" })
    p.breakReads()
    const store = p.store()
    store.restore()
    expect(store.get()).toBe("system")
    expect(p.applied).toEqual(["unspecified"])
  })
})

describe("choosing an appearance", () => {
  test("switches the app at once and keeps the choice on the phone", async () => {
    const p = phone()
    const store = p.store()
    store.restore()
    await store.choose("light")
    expect(store.get()).toBe("light")
    expect(p.applied).toEqual(["unspecified", "light"])
    expect(p.kept.get("oja.appearance")).toBe("light")
  })

  test("hands the theme back to the phone when System is chosen", async () => {
    const p = phone({ "oja.appearance": "dark" })
    const store = p.store()
    store.restore()
    await store.choose("system")
    expect(p.applied).toEqual(["dark", "unspecified"])
    expect(p.kept.get("oja.appearance")).toBe("system")
  })

  test("a choice the phone can't keep goes back to what it was, and rejects", async () => {
    const p = phone({ "oja.appearance": "dark" })
    const store = p.store()
    store.restore()
    p.breakWrites()
    await expect(store.choose("light")).rejects.toThrow("keychain full")
    expect(store.get()).toBe("dark")
    expect(p.applied).toEqual(["dark", "light", "dark"])
  })

  test("a choice the phone failed to keep doesn't undo one made after it", async () => {
    const p = phone({ "oja.appearance": "dark" })
    const store = p.store()
    store.restore()
    const light = p.holdWrite("light")
    const first = store.choose("light")
    const second = store.choose("system")
    light.fail()
    await expect(first).rejects.toThrow("keychain busy")
    await second
    expect(store.get()).toBe("system")
    expect(p.kept.get("oja.appearance")).toBe("system")
    expect(p.applied).toEqual(["dark", "light", "unspecified"])
  })

  test("tells subscribers when the choice changes", async () => {
    const p = phone()
    const store = p.store()
    store.restore()
    const seen: string[] = []
    const unsubscribe = store.subscribe(() => seen.push(store.get()))
    await store.choose("dark")
    unsubscribe()
    await store.choose("light")
    expect(seen).toEqual(["dark"])
  })
})
