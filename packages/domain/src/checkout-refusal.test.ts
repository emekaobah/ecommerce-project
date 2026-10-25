import { describe, expect, test } from "bun:test"
import { checkoutRefusalMessage, paymentRefusal } from "./checkout-refusal"

const shop = (name: string, overrides = {}) => ({
  seller: { name },
  method: "delivery" as const,
  shop_status: { orderable: true, label: "Open · closes 7pm" },
  delivery_unavailable: null,
  ...overrides,
})

describe("paymentRefusal", () => {
  test("a shop that stopped taking orders, named, with when it opens", () => {
    const sellers = [shop("Adire House"), shop("Iya Bisi Foodstuff", { shop_status: { orderable: false, label: "Closed until Tue 14 Oct" } })]
    expect(paymentRefusal({ sellers, ready_to_pay: true })).toBe("Iya Bisi Foodstuff isn't taking orders now. Closed until Tue 14 Oct.")
  })

  test("a shop no courier can bring the fresh items from in time", () => {
    const sellers = [shop("Iya Bisi Foodstuff", { delivery_unavailable: { code: "perishable_too_slow" } })]
    expect(paymentRefusal({ sellers, ready_to_pay: true })).toBe(
      "No courier can bring Iya Bisi Foodstuff's fresh items in time. Collect them in store, or remove them."
    )
  })

  test("a shop still to choose a delivery for", () => {
    expect(paymentRefusal({ sellers: [shop("Adire House")], ready_to_pay: false })).toBe("Choose how each shop's order reaches you before paying.")
  })

  test("nothing the checkout shows: the screen's own words", () => {
    expect(paymentRefusal({ sellers: [shop("Adire House")], ready_to_pay: true })).toBeNull()
  })
})

// #106: the two checkout refusals that change what the buyer does next carry a code.
describe("checkoutRefusalMessage", () => {
  const ADIRE = { id: "sel_adire", name: "Adire House" }

  test.each([
    ["promo_code_not_found", "That isn't a valid promo code. Check it and try again."],
    ["promo_code_expired", "That code has expired."],
    ["promo_code_not_started", "That code isn't on yet. Try it again once the deal starts."],
    ["promo_code_used_up", "That code has been used up."],
    ["promo_code_not_applicable", "That code doesn't apply to the items in your cart."],
  ])("a promo code refused with %s", (code, words) => {
    expect(checkoutRefusalMessage({ code, type: "invalid_data", message: "developer text" })).toBe(words)
  })

  test("another shop's promo code names the shop", () => {
    expect(checkoutRefusalMessage({ code: "promo_code_other_shop", seller: ADIRE })).toBe(
      "That's Adire House's code. It only takes money off their items, and none in your cart qualify."
    )
  })

  test("a shop that doesn't deliver to the address, with pickup to choose instead", () => {
    expect(checkoutRefusalMessage({ code: "shop_doesnt_deliver", seller: ADIRE, offers_pickup: true })).toBe(
      "Adire House doesn't deliver to this address. Use another address, collect the order in store, or remove Adire House's items."
    )
  })

  test("a shop that doesn't deliver to the address and has no pickup", () => {
    expect(checkoutRefusalMessage({ code: "shop_doesnt_deliver", seller: ADIRE, offers_pickup: false })).toBe(
      "Adire House doesn't deliver to this address. Use another address, or remove Adire House's items."
    )
  })

  test("a refusal that needs the shop but doesn't name it is not worded", () => {
    expect(checkoutRefusalMessage({ code: "shop_doesnt_deliver" })).toBeNull()
    expect(checkoutRefusalMessage({ code: "promo_code_other_shop", seller: { id: "sel_adire" } })).toBeNull()
  })

  test("an unknown code, no code, or no body: the screen's own words", () => {
    expect(checkoutRefusalMessage({ code: "invalid_request_error", message: "Stage must be one of…" })).toBeNull()
    expect(checkoutRefusalMessage({ message: "Offer with id x was not found" })).toBeNull()
    expect(checkoutRefusalMessage({ code: "toString" })).toBeNull()
    expect(checkoutRefusalMessage(undefined)).toBeNull()
    expect(checkoutRefusalMessage("not json")).toBeNull()
  })
})
