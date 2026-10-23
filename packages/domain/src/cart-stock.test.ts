import { describe, expect, test } from "bun:test"
import { shortLineLabel, soldOutButtonLabel } from "./cart-stock"

describe("soldOutButtonLabel", () => {
  test("names one sold-out item", () => {
    expect(soldOutButtonLabel(1)).toBe("Remove 1 sold-out item")
  })

  test("counts several sold-out items in the plural", () => {
    expect(soldOutButtonLabel(2)).toBe("Remove 2 sold-out items")
  })
})

describe("shortLineLabel", () => {
  test("says how many are left and offers to change to that", () => {
    expect(shortLineLabel(2)).toBe("Only 2 left · Change to 2")
  })

  test("says so even when more are left than the low-stock cue counts", () => {
    expect(shortLineLabel(12)).toBe("Only 12 left · Change to 12")
  })
})
