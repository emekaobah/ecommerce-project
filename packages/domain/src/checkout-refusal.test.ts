import { describe, expect, test } from "bun:test"
import { paymentRefusal } from "./checkout-refusal"

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
