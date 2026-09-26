import { describe, expect, test } from "bun:test"
import { formatMoney } from "./index"

describe("formatMoney", () => {
  test("uses the currency it is given", () => {
    expect(formatMoney(1500, "ngn", "en-NG")).toContain("1,500")
    expect(formatMoney(12.5, "eur", "en-GB")).toBe("€12.50")
  })
})
