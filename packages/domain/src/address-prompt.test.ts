import { describe, expect, test } from "bun:test"
import { addressPromptShown } from "./address-prompt"

const home = { id: "addr_home", address_1: "14 Bode Thomas St", city: "Surulere", province: "Lagos" }
const spot = { latitude: 6.4281, longitude: 3.4219, name: "Victoria Island" }

describe("addressPromptShown", () => {
  test("asks a signed-in buyer with no saved address where to deliver", () => {
    expect(addressPromptShown({ userId: "user_tolu", saved: [], spot: null, choice: null })).toBe(true)
  })

  test("stays hidden once the buyer puts it off this session", () => {
    const choice = { by: "user_tolu", shown: false }
    expect(addressPromptShown({ userId: "user_tolu", saved: [], spot: null, choice })).toBe(false)
  })

  test("asks another buyer who signs in on the same phone, though the last one put it off", () => {
    const choice = { by: "user_tolu", shown: false }
    expect(addressPromptShown({ userId: "user_ada", saved: [], spot: null, choice })).toBe(true)
  })

  test("never shows by itself while addresses load, or once there is a saved address", () => {
    expect(addressPromptShown({ userId: "user_tolu", saved: undefined, spot: null, choice: null })).toBe(false)
    expect(addressPromptShown({ userId: "user_tolu", saved: [home], spot: null, choice: null })).toBe(false)
  })

  test("asks a guest without a spot where to deliver", () => {
    expect(addressPromptShown({ userId: null, saved: undefined, spot: null, choice: null })).toBe(true)
  })

  test("stays hidden for a guest who put it off, until the next launch", () => {
    const choice = { by: "guest", shown: false }
    expect(addressPromptShown({ userId: null, saved: undefined, spot: null, choice })).toBe(false)
  })

  test("doesn't ask a guest who has a spot, while the spot is read, or before sign-in state is known", () => {
    expect(addressPromptShown({ userId: null, saved: undefined, spot, choice: null })).toBe(false)
    expect(addressPromptShown({ userId: null, saved: undefined, spot: undefined, choice: null })).toBe(false)
    expect(addressPromptShown({ userId: undefined, saved: undefined, spot: null, choice: null })).toBe(false)
  })

  test("shows when the band asks again, even for a guest with a spot", () => {
    const choice = { by: "guest", shown: true }
    expect(addressPromptShown({ userId: null, saved: undefined, spot, choice })).toBe(true)
  })

  test("a guest who put it off and then signs in is asked as a buyer", () => {
    const choice = { by: "guest", shown: false }
    expect(addressPromptShown({ userId: "user_tolu", saved: [], spot: null, choice })).toBe(true)
  })
})
