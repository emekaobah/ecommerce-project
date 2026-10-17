import { describe, expect, test } from "bun:test"
import { formatMoney } from "./money"
import { notPlacedChangeMessage, notPlacedMessage, notPlacedPush } from "./not-placed"

const refunded = `You've been refunded ${formatMoney(39920, "ngn")}.`

describe("notPlacedMessage", () => {
  test.each([
    ["code_used_up", "This code was used up while you paid."],
    ["sold_out", "An item sold out while you paid."],
    ["unavailable", "An item or shop is no longer available."],
    ["delivery", "This delivery option is no longer available."],
    ["other", "Something went wrong placing your order."],
  ] as const)("says why a %s cart wasn't placed, and what was refunded", (reason, why) => {
    expect(notPlacedMessage({ reason, amount: 39920 }, "ngn")).toBe(`${why} ${refunded}`)
  })
})

describe("notPlacedChangeMessage", () => {
  test("names the code taken off", () => {
    expect(notPlacedChangeMessage({ type: "code_removed", code: "LAST1" })).toBe("LAST1 was taken off.")
  })

  test("says how many of a sold-out item are left in the cart", () => {
    expect(
      notPlacedChangeMessage({
        type: "quantity_reduced",
        product_title: "Ofada Rice 5kg",
        variant_title: "Ofada Rice 5kg",
        seller: "Iya Bisi Foodstuff",
        was: 2,
        now: 1,
      })
    ).toBe("Ofada Rice 5kg from Iya Bisi Foodstuff: only 1 left, so you now have 1 (was 2).")
  })

  test("says an item was removed, naming its option and shop", () => {
    expect(
      notPlacedChangeMessage({
        type: "item_removed",
        product_title: "Adire Kaftan",
        variant_title: "M",
        seller: "Aso Oke House",
        quantity: 1,
      })
    ).toBe("Adire Kaftan (M) from Aso Oke House was removed.")
  })

  test("says an item whose shop is gone was removed", () => {
    expect(
      notPlacedChangeMessage({ type: "item_removed", product_title: "Lantern", variant_title: null, seller: null, quantity: 2 })
    ).toBe("Lantern was removed.")
  })

  test("asks for a new delivery for a shop whose option is gone", () => {
    expect(notPlacedChangeMessage({ type: "delivery_removed", seller: "Ikeja Gadget Hub" })).toBe(
      "Choose a new delivery for Ikeja Gadget Hub."
    )
  })
})

describe("notPlacedPush", () => {
  test("tells the buyer the order wasn't placed, why, and what was refunded", () => {
    expect(notPlacedPush({ reason: "sold_out", amount: 39920 }, "ngn")).toEqual({
      title: "Your order wasn't placed",
      body: `An item sold out while you paid. ${refunded}`,
    })
  })
})
