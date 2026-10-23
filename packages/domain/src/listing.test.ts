import { describe, expect, test } from "bun:test"
import { bySize, dealLabel, formatWeight, groupByShop, listingPrice, offerPrice, shipsIn } from "./listing"

let nextId = 0
const offer = (calculated_amount: number, original_amount = calculated_amount) => ({
  id: `offer_${++nextId}`,
  calculated_price: { calculated_amount, original_amount },
})

describe("offerPrice", () => {
  test("shows the selling price with no compare-at when there is no sale", () => {
    expect(offerPrice(offer(1500))).toEqual({ amount: 1500, compareAt: null })
  })

  test("shows the original as compare-at only when it is above the selling price", () => {
    expect(offerPrice(offer(1200, 1500))).toEqual({ amount: 1200, compareAt: 1500 })
    expect(offerPrice(offer(1500, 1200))).toEqual({ amount: 1500, compareAt: null })
  })
})

describe("listingPrice", () => {
  test("is the shop's one price when every variant costs the same", () => {
    const [first, second] = [offer(28000), offer(28000)]
    expect(listingPrice([first, second])).toEqual({ amount: 28000, compareAt: null, from: false, offerId: first.id })
  })

  test("is 'from' the shop's cheapest variant when variant prices differ", () => {
    const cheapest = offer(28000)
    expect(listingPrice([offer(30000), cheapest, offer(32000)])).toEqual({
      amount: 28000,
      compareAt: null,
      from: true,
      offerId: cheapest.id,
    })
  })

  test("carries the cheapest variant's compare-at", () => {
    const onSale = offer(25000, 28000)
    expect(listingPrice([offer(30000), onSale])).toEqual({ amount: 25000, compareAt: 28000, from: true, offerId: onSale.id })
  })

  test("is undefined for a listing without offers", () => {
    expect(listingPrice([])).toBeUndefined()
  })
})

describe("shipsIn", () => {
  test("describes the shop's lead time in days", () => {
    expect(shipsIn(0)).toBe("Ships today")
    expect(shipsIn(1)).toBe("Ships in 1 day")
    expect(shipsIn(3)).toBe("Ships in 3 days")
  })
})

describe("formatWeight", () => {
  test("shows grams under a kilo and kilos from a kilo up", () => {
    expect(formatWeight(450, "en-NG")).toBe("450 g")
    expect(formatWeight(1000, "en-NG")).toBe("1 kg")
    expect(formatWeight(1500, "en-NG")).toBe("1.5 kg")
  })

  test("stays metric with two decimals whatever the locale's measurement system", () => {
    expect(formatWeight(150, "en-US")).toBe("150 g")
    expect(formatWeight(600, "en-US")).toBe("600 g")
    expect(formatWeight(1500, "en-US")).toBe("1.5 kg")
    expect(formatWeight(1323, "en-US")).toBe("1.32 kg")
  })
})

describe("groupByShop", () => {
  const listing = (shop: string, product: string) => ({ seller: { id: shop, name: `Shop ${shop}` }, product })

  test("gathers each shop's listings under it, shops in the order their best result came", () => {
    const [bCharger, aCharger, bLantern, cFan] = [
      listing("b", "charger"),
      listing("a", "charger"),
      listing("b", "lantern"),
      listing("c", "fan"),
    ]

    expect(groupByShop([bCharger, aCharger, bLantern, cFan])).toEqual([
      { seller: { id: "b", name: "Shop b" }, listings: [bCharger, bLantern] },
      { seller: { id: "a", name: "Shop a" }, listings: [aCharger] },
      { seller: { id: "c", name: "Shop c" }, listings: [cFan] },
    ])
  })

  test("is empty for no results", () => {
    expect(groupByShop([])).toEqual([])
  })
})

// A listing's badge for its shop's automatic promotion (#6): only ever that shop's own deal.
describe("dealLabel", () => {
  test("says a percentage off at the shop", () => {
    expect(dealLabel({ type: "percentage", value: 10, allocation: "each", currency_code: "ngn" })).toBe("10% off at this shop")
  })

  test("says an amount off each item, or off what is bought from the shop", () => {
    expect(dealLabel({ type: "fixed", value: 500, allocation: "each", currency_code: "ngn" }, "en-NG")).toBe(
      "₦500.00 off each at this shop"
    )
    expect(dealLabel({ type: "fixed", value: 1000, allocation: "across", currency_code: "ngn" }, "en-NG")).toBe(
      "₦1,000.00 off at this shop"
    )
  })
})

// A product's size chips, small to large whatever order the shop added them in (catalogue 13: 2kg, 5kg, 10kg).
describe("bySize", () => {
  const sizes = (...titles: (string | null)[]) => titles.map((variant_title) => ({ variant_title }))
  const titles = (offers: { variant_title: string | null }[]) => offers.map((o) => o.variant_title)

  test("orders weights small to large", () => {
    expect(titles(bySize(sizes("10kg", "2kg", "5kg")))).toEqual(["2kg", "5kg", "10kg"])
  })

  test("orders clothing sizes small to large", () => {
    expect(titles(bySize(sizes("XL", "M", "S", "L")))).toEqual(["S", "M", "L", "XL"])
    expect(titles(bySize(sizes("XXL", "XS", "2XL")))).toEqual(["XS", "XXL", "2XL"])
  })

  test("orders volumes small to large", () => {
    expect(titles(bySize(sizes("3L", "500ml", "1 litre", "75cl")))).toEqual(["500ml", "75cl", "1 litre", "3L"])
  })

  test("keeps sizes it can't measure in the shop's order, after the ones it can", () => {
    expect(titles(bySize(sizes("Family pack", "500g", null, "Single", "1kg")))).toEqual(["500g", "1kg", "Family pack", null, "Single"])
  })
})
