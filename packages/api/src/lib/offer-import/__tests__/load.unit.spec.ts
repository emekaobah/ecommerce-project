import { storeCurrency } from "../load"

describe("storeCurrency", () => {
  it("is the store's default currency, else the first it supports", () => {
    expect(storeCurrency([{ currency_code: "usd", is_default: false }, { currency_code: "ngn", is_default: true }])).toBe("ngn")
    expect(storeCurrency([{ currency_code: "ghs", is_default: false }])).toBe("ghs")
  })

  it("refuses to guess when the store supports no currency", () => {
    expect(() => storeCurrency([])).toThrow("The store has no currency set up, so prices can't be read.")
    expect(() => storeCurrency(null)).toThrow("The store has no currency set up")
  })
})
