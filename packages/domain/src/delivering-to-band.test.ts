import { describe, expect, test } from "bun:test"
import { deliveringToBand, needsFirstAddress } from "./delivering-to-band"

describe("deliveringToBand", () => {
  test("says it is finding the address while the address is worked out, muted and not tappable", () => {
    expect(deliveringToBand({ address: undefined, signedIn: false, saved: undefined, error: false })).toEqual({
      label: "Finding your address…",
      action: "none",
      muted: true,
      chooses: false,
    })
  })

  test("asks a signed-in buyer without a saved address to add one, offered as a choice", () => {
    expect(deliveringToBand({ address: null, signedIn: true, saved: [], error: false })).toEqual({
      label: "Add a delivery address",
      action: "addAddress",
      muted: false,
      chooses: true,
    })
  })

  test("asks a guest to sign in, since addresses belong to accounts", () => {
    expect(deliveringToBand({ address: null, signedIn: false, saved: undefined, error: false })).toMatchObject({
      label: "Sign in to see shops near you",
      action: "signIn",
      muted: false,
    })
  })

  test("offers a retry when the buyer's addresses won't load", () => {
    expect(deliveringToBand({ address: null, signedIn: true, saved: undefined, error: true })).toMatchObject({
      label: "Couldn't load your addresses. Tap to retry",
      action: "retry",
      muted: false,
    })
  })

  test("names the address shops are measured from, which opens the list to switch it", () => {
    const home = { id: "addr_home", address_1: "14 Bode Thomas St", city: "Surulere", province: "Lagos" }
    expect(deliveringToBand({ address: home, signedIn: true, saved: [home], error: false })).toEqual({
      label: "14 Bode Thomas St, Surulere, Lagos",
      action: "choose",
      muted: false,
      chooses: true,
    })
  })

  test("asks a buyer whose addresses have neither a picked nor a default one to choose", () => {
    const office = { id: "addr_office", address_1: "3 Allen Ave", city: "Ikeja", province: "Lagos" }
    expect(deliveringToBand({ address: null, signedIn: true, saved: [office], error: false })).toEqual({
      label: "Choose a delivery address",
      action: "choose",
      muted: false,
      chooses: true,
    })
  })
})

describe("needsFirstAddress", () => {
  const home = { id: "addr_home", address_1: "14 Bode Thomas St", city: "Surulere", province: "Lagos" }

  test("a signed-in buyer whose saved addresses loaded empty needs a first address", () => {
    expect(needsFirstAddress({ address: null, signedIn: true, saved: [], error: false })).toBe(true)
  })

  test("a guest, a buyer whose addresses are loading or won't load, or one with an address doesn't", () => {
    expect(needsFirstAddress({ address: null, signedIn: false, saved: undefined, error: false })).toBe(false)
    expect(needsFirstAddress({ address: undefined, signedIn: true, saved: undefined, error: false })).toBe(false)
    expect(needsFirstAddress({ address: null, signedIn: true, saved: undefined, error: true })).toBe(false)
    expect(needsFirstAddress({ address: null, signedIn: true, saved: [home], error: false })).toBe(false)
  })
})
