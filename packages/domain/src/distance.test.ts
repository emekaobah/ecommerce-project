import { describe, expect, test } from "bun:test"
import { deliveringTo, distanceBand, distanceKm, distanceLabel, roundedDistanceKm } from "./distance"

// Seeded shops' pickup pins in Lagos.
const SURULERE = { latitude: 6.4953, longitude: 3.3548 }
const IKEJA = { latitude: 6.5965, longitude: 3.3421 }
const LEKKI = { latitude: 6.4478, longitude: 3.4723 }

describe("distanceKm", () => {
  test("is the straight-line distance between two pins", () => {
    // Surulere to Computer Village, Ikeja: about 11.3 km as the crow flies; Lekki to Ikeja about 21.9 km.
    expect(distanceKm(SURULERE, IKEJA)).toBeCloseTo(11.34, 1)
    expect(distanceKm(LEKKI, IKEJA)).toBeCloseTo(21.92, 1)
  })

  test("is the same both ways, and nothing between a pin and itself", () => {
    expect(distanceKm(IKEJA, SURULERE)).toBeCloseTo(distanceKm(SURULERE, IKEJA), 9)
    expect(distanceKm(LEKKI, LEKKI)).toBe(0)
  })
})

describe("distanceBand", () => {
  test("puts a shop under 5 km first, then 5 to 15 km, then further", () => {
    expect(distanceBand(0)).toBe(0)
    expect(distanceBand(4.99)).toBe(0)
    expect(distanceBand(5)).toBe(1)
    expect(distanceBand(14.99)).toBe(1)
    expect(distanceBand(15)).toBe(2)
    expect(distanceBand(120)).toBe(2)
  })
})

describe("roundedDistanceKm", () => {
  test("is 0 under a kilometre, else the nearest whole kilometre", () => {
    expect(roundedDistanceKm(0.2)).toBe(0)
    expect(roundedDistanceKm(0.99)).toBe(0)
    expect(roundedDistanceKm(1)).toBe(1)
    expect(roundedDistanceKm(1.49)).toBe(1)
    expect(roundedDistanceKm(11.33)).toBe(11)
    expect(roundedDistanceKm(11.5)).toBe(12)
  })
})

describe("distanceLabel", () => {
  test("says 'under 1 km', then whole kilometres", () => {
    expect(distanceLabel(0)).toBe("under 1 km")
    expect(distanceLabel(1)).toBe("1 km")
    expect(distanceLabel(12)).toBe("12 km")
  })
})

describe("deliveringTo", () => {
  const home = { id: "addr_home", is_default_shipping: true }
  const office = { id: "addr_office", is_default_shipping: false }

  test("starts on the buyer's default saved address", () => {
    expect(deliveringTo([office, home], null)).toBe("addr_home")
  })

  test("keeps the address the buyer picked while it is saved", () => {
    expect(deliveringTo([home, office], "addr_office")).toBe("addr_office")
  })

  test("falls back to the default when the picked address was deleted", () => {
    expect(deliveringTo([home], "addr_office")).toBe("addr_home")
  })

  test("is none without saved addresses, or with neither a pick nor a default", () => {
    expect(deliveringTo([], "addr_office")).toBeNull()
    expect(deliveringTo([office], null)).toBeNull()
  })
})
