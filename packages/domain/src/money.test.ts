import { describe, expect, test } from "bun:test"
import { formatMoney } from "./money"

describe("formatMoney", () => {
  test("formats in the currency it is given", () => {
    expect(formatMoney(1500, "NGN", "en-NG")).toBe("₦1,500.00")
    expect(formatMoney(12.5, "EUR", "en-GB")).toBe("€12.50")
  })

  test("accepts Medusa's lowercase currency codes", () => {
    expect(formatMoney(250, "ngn", "en-NG")).toBe("₦250.00")
  })
})
