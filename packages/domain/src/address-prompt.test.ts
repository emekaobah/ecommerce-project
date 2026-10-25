import { describe, expect, test } from "bun:test"
import { addressPromptShown } from "./address-prompt"

const home = { id: "addr_home", address_1: "14 Bode Thomas St", city: "Surulere", province: "Lagos" }

describe("addressPromptShown", () => {
  test("asks a signed-in buyer with no saved address where to deliver", () => {
    expect(addressPromptShown({ userId: "user_tolu", saved: [], dismissedBy: null })).toBe(true)
  })

  test("stays hidden once the buyer puts it off this session", () => {
    expect(addressPromptShown({ userId: "user_tolu", saved: [], dismissedBy: "user_tolu" })).toBe(false)
  })

  test("asks another buyer who signs in on the same phone, though the last one put it off", () => {
    expect(addressPromptShown({ userId: "user_ada", saved: [], dismissedBy: "user_tolu" })).toBe(true)
  })

  test("never shows for a guest, while addresses load, or once there is a saved address", () => {
    expect(addressPromptShown({ userId: null, saved: undefined, dismissedBy: null })).toBe(false)
    expect(addressPromptShown({ userId: "user_tolu", saved: undefined, dismissedBy: null })).toBe(false)
    expect(addressPromptShown({ userId: "user_tolu", saved: [home], dismissedBy: null })).toBe(false)
  })
})
