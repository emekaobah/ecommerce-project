import { describe, expect, test } from "bun:test"
import { createKeptValue } from "./kept-value"

/** A phone's storage held in a map, whose writes can each be held until they are failed or kept. */
function phone(stored: Record<string, string> = {}) {
  const kept = new Map(Object.entries(stored))
  const held = new Map<string, Promise<void>>()
  let failRemoves = false
  const value = createKeptValue<string>({
    key: "k",
    initial: "none",
    codec: {
      parse: (s) => {
        if (s === "garbled") throw new Error("not JSON")
        return s
      },
      stringify: (v) => v,
    },
    storage: {
      write: async (key, v) => {
        await held.get(v)
        kept.set(key, v)
      },
      remove: async (key) => {
        if (failRemoves) throw new Error("keychain locked")
        kept.delete(key)
      },
    },
  })
  return {
    kept,
    value,
    breakRemoves: () => (failRemoves = true),
    /** Holds the phone's write of `v` until it is failed or kept. */
    hold(v: string) {
      let release: (error?: Error) => void = () => undefined
      held.set(
        v,
        new Promise<void>((resolve, reject) => {
          release = (error) => (error ? reject(error) : resolve())
        }),
      )
      return { fail: () => release(new Error("keychain busy")), keep: () => release() }
    },
  }
}

describe("loading a kept value", () => {
  test("takes what the phone holds", () => {
    const p = phone()
    p.value.load("banner")
    expect(p.value.get()).toBe("banner")
  })

  test("nothing kept, or what was kept won't parse, is the initial value", () => {
    const p = phone()
    p.value.load(null)
    expect(p.value.get()).toBe("none")
    p.value.load("garbled")
    expect(p.value.get()).toBe("none")
  })
})

describe("saving while earlier saves are on their way", () => {
  test("the phone keeps them in the order they were made", async () => {
    const p = phone()
    const a = p.hold("a")
    const first = p.value.save("a")
    const second = p.value.save("b")
    a.keep()
    await Promise.all([first, second])
    expect(p.kept.get("k")).toBe("b")
    expect(p.value.get()).toBe("b")
  })

  test("a later save that fails goes back to the earlier one the phone kept", async () => {
    const p = phone()
    const b = p.hold("b")
    const first = p.value.save("a")
    const second = p.value.save("b")
    b.fail()
    await first
    await expect(second).rejects.toThrow("keychain busy")
    expect(p.value.get()).toBe("a")
    expect(p.kept.get("k")).toBe("a")
  })

  test("when every save fails, back to what the phone held before them", async () => {
    const p = phone({ k: "x" })
    p.value.load("x")
    const a = p.hold("a")
    const b = p.hold("b")
    const first = p.value.save("a")
    const second = p.value.save("b")
    a.fail()
    // The earlier failure leaves the later change showing while it is still on its way.
    await expect(first).rejects.toThrow("keychain busy")
    expect(p.value.get()).toBe("b")
    b.fail()
    await expect(second).rejects.toThrow("keychain busy")
    expect(p.value.get()).toBe("x")
  })
})

describe("forgetting a kept value", () => {
  test("goes back to the initial value, on the phone too", async () => {
    const p = phone()
    await p.value.save("shop")
    await p.value.forget()
    expect(p.value.get()).toBe("none")
    expect(p.kept.has("k")).toBe(false)
  })

  test("a save that fails afterwards never brings the forgotten value back", async () => {
    const p = phone()
    await p.value.save("shop")
    p.breakRemoves()
    await expect(p.value.forget()).rejects.toThrow("keychain locked")
    const next = p.hold("other")
    const saving = p.value.save("other")
    next.fail()
    await expect(saving).rejects.toThrow("keychain busy")
    expect(p.value.get()).toBe("none")
  })
})
