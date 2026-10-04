import { describe, expect, test } from "bun:test"
import { formFromLookup, mapCentre, stateFromLookup, type LookedUpPlace } from "./address-lookup"

// State names as Google returned them in the check of 2026-10-04 (ADR 0002).
describe("stateFromLookup", () => {
  test.each([
    ["Lagos", "Lagos"],
    ["Federal Capital Territory", "Federal Capital Territory"],
    ["Rivers", "Rivers"],
    ["Akwa Ibom", "Akwa Ibom"],
    ["Cross River", "Cross River"],
    ["Nasarawa", "Nasarawa"],
    ["Oyo", "Oyo"],
  ])("takes Google's %s as the state %s", (name, state) => {
    expect(stateFromLookup(name, "NG")).toBe(state)
  })

  test.each([
    ["Lagos State", "Lagos"],
    ["Rivers State", "Rivers"],
    ["Abuja", "Federal Capital Territory"],
    ["FCT", "Federal Capital Territory"],
    ["Nassarawa", "Nasarawa"],
    ["Akwa-Ibom", "Akwa Ibom"],
    ["  lagos ", "Lagos"],
  ])("maps the variant %s onto %s", (name, state) => {
    expect(stateFromLookup(name, "NG")).toBe(state)
  })

  test("leaves the state for the buyer to choose when the name isn't one", () => {
    expect(stateFromLookup("Greater Accra", "NG")).toBeNull()
    expect(stateFromLookup(null, "NG")).toBeNull()
  })
})

const VICTORIA_ISLAND: LookedUpPlace = {
  formatted_address: "3 Akin Adesola St, Victoria Island, Lagos 106104, Lagos, Nigeria",
  location: { latitude: 6.4318, longitude: 3.4215 },
  country_code: "NG",
  street: "3 Akin Adesola Street",
  area: "Victoria Island",
  town: "Lagos",
  district: "Eti Osa",
  state: "Lagos",
  postal_code: "106104",
}

describe("formFromLookup", () => {
  test("fills the street with its area, the LGA and the state", () => {
    expect(formFromLookup(VICTORIA_ISLAND, "NG")).toEqual({
      address_1: "3 Akin Adesola Street, Victoria Island",
      city: "Eti Osa",
      province: "Lagos",
    })
  })

  test("fills what an area-only place has, leaving the street to the buyer's edit", () => {
    const transAmadi = { ...VICTORIA_ISLAND, street: null, area: "Trans Amadi", district: "Obio/Akpor", state: "Rivers" }

    expect(formFromLookup(transAmadi, "NG")).toEqual({ address_1: "Trans Amadi", city: "Obio/Akpor", province: "Rivers" })
  })

  test("empties what the place doesn't know, so an earlier place's street doesn't linger", () => {
    const bare = { ...VICTORIA_ISLAND, street: null, area: null, district: null, state: "Lagos State" }

    expect(formFromLookup(bare, "NG")).toEqual({ address_1: "", city: "", province: "Lagos" })
  })
})

describe("mapCentre", () => {
  test("opens the map on the chosen state", () => {
    expect(mapCentre("Rivers", "NG")).toEqual({ latitude: 4.8396, longitude: 6.9112, zoom: "state" })
  })

  test("opens it on the country when no state is chosen", () => {
    expect(mapCentre("", "NG")).toEqual({ latitude: 9.082, longitude: 8.6753, zoom: "country" })
    expect(mapCentre("Atlantis", "NG").zoom).toBe("country")
  })
})
