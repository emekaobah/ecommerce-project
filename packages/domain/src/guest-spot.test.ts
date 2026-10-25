import { describe, expect, test } from "bun:test"
import { addressEntryStart, guestSpotName, measuredFrom } from "./guest-spot"

describe("guestSpotName", () => {
  test("names the spot by its area, as the phone's geocoder gives it", () => {
    expect(guestSpotName({ district: "Victoria Island", street: "Adeola Odeku St" })).toBe("Victoria Island")
  })

  test("falls back to the street when the geocoder gives no area", () => {
    expect(guestSpotName({ district: null, street: "Adeola Odeku St" })).toBe("Adeola Odeku St")
  })

  test("has no name with neither an area nor a street, even when the town is known", () => {
    const townOnly = { district: null, street: null, city: "Lagos" }
    expect(guestSpotName(townOnly)).toBeNull()
    expect(guestSpotName(undefined)).toBeNull()
    expect(guestSpotName({ district: " ", street: null })).toBeNull()
  })
})

describe("measuredFrom", () => {
  const spot = { latitude: 6.4281, longitude: 3.4219 }

  test("sends the spot as near, latitude then longitude, when there's no saved address", () => {
    expect(measuredFrom({ addressId: null, near: spot })).toEqual({ near: "6.4281,3.4219" })
  })

  test("sends the spot as plain decimals the server takes, never in exponent form", () => {
    expect(measuredFrom({ addressId: null, near: { latitude: 0.0000001, longitude: -0.0000008 } })).toEqual({ near: "0,-0.000001" })
  })

  test("sends only the saved address when there is one, since it wins over the spot", () => {
    expect(measuredFrom({ addressId: "addr_home", near: spot })).toEqual({ address_id: "addr_home" })
  })

  test("sends neither without an address or a spot", () => {
    expect(measuredFrom({ addressId: null, near: null })).toEqual({})
  })
})

describe("addressEntryStart", () => {
  const spot = { latitude: 6.4281, longitude: 3.4219, name: "Victoria Island" }

  test("starts a buyer's first address at the spot they shared as a guest, as a plain pin", () => {
    expect(addressEntryStart({ way: undefined, firstAddress: true, spot })).toEqual({ latitude: 6.4281, longitude: 3.4219 })
  })

  test("locates the buyer when they chose their current location", () => {
    expect(addressEntryStart({ way: "here", firstAddress: true, spot })).toBe("here")
  })

  test("opens the search when the buyer chose to search, though they have a spot", () => {
    expect(addressEntryStart({ way: "search", firstAddress: true, spot })).toBeUndefined()
  })

  test("opens the search for a later address, or without a spot", () => {
    expect(addressEntryStart({ way: undefined, firstAddress: false, spot })).toBeUndefined()
    expect(addressEntryStart({ way: undefined, firstAddress: true, spot: null })).toBeUndefined()
  })
})
