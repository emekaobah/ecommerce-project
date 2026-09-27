import { describe, expect, test } from "bun:test"
import { formatWeight, listingPrice, offerPrice, shipsIn } from "./listing"

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
})
