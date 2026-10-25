import { describe, expect, test } from "bun:test"
import { guestSpotName, measuredFrom } from "./guest-spot"

describe("guestSpotName", () => {
  test("names the spot by its area, as the phone's geocoder gives it", () => {
    expect(guestSpotName({ district: "Victoria Island", street: "Adeola Odeku St", city: "Lagos" })).toBe("Victoria Island")
  })

  test("falls back to the street, then the town, when the geocoder gives no area", () => {
    expect(guestSpotName({ district: null, street: "Adeola Odeku St", city: "Lagos" })).toBe("Adeola Odeku St")
    expect(guestSpotName({ district: null, street: null, city: "Lagos" })).toBe("Lagos")
  })

  test("has no name when the geocoder found nothing, or only blanks", () => {
    expect(guestSpotName(undefined)).toBeNull()
    expect(guestSpotName({ district: " ", street: null, city: null })).toBeNull()
  })
})

describe("measuredFrom", () => {
  const spot = { latitude: 6.4281, longitude: 3.4219 }

  test("sends the spot as near, latitude then longitude, when there's no saved address", () => {
    expect(measuredFrom({ addressId: null, near: spot })).toEqual({ near: "6.4281,3.4219" })
  })

  test("sends only the saved address when there is one, since it wins over the spot", () => {
    expect(measuredFrom({ addressId: "addr_home", near: spot })).toEqual({ address_id: "addr_home" })
  })

  test("sends neither without an address or a spot", () => {
    expect(measuredFrom({ addressId: null, near: null })).toEqual({})
  })
})
