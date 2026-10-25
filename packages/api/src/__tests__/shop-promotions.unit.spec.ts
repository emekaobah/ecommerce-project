import { promoCodeProblem, shopAdjustments } from "../lib/promotions"

// A cart's promotions are worked out shop by shop (#6): a shop's promotion on that shop's items
// alone, the operator's on the whole cart, so one shop's deal never discounts another's items.
describe("shopAdjustments", () => {
  const owners = new Map<string, { id: string; seller_id: string | null }>([
    ["GROCER10", { id: "promo_grocer", seller_id: "sel_grocer" }],
    ["GADGET5", { id: "promo_gadget", seller_id: "sel_gadget" }],
    ["OJA500", { id: "promo_oja", seller_id: null }],
    ["FREEDELIVERY", { id: "promo_delivery", seller_id: null }],
  ])
  const caps = new Map([
    ["item_rice", 5000],
    ["item_lantern", 4000],
  ])
  const item = (code: string, item_id: string, amount: number) =>
    ({ action: "addItemAdjustment", code, item_id, amount, is_tax_inclusive: false }) as const

  it("keeps each pass's own promotions: a shop's on its items, the operator's on the cart", () => {
    const result = shopAdjustments({
      passes: [
        {
          seller_id: null,
          // Worked out on the whole cart, the grocer's 10% would reach the lantern too.
          actions: [item("OJA500", "item_rice", 300), item("OJA500", "item_lantern", 200), item("GROCER10", "item_lantern", 400)],
        },
        { seller_id: "sel_grocer", actions: [item("GROCER10", "item_rice", 500), item("OJA500", "item_rice", 500)] },
      ],
      owners,
      caps,
    })

    expect(result.items).toEqual([
      { code: "OJA500", promotion_id: "promo_oja", item_id: "item_rice", amount: 300, is_tax_inclusive: false },
      { code: "OJA500", promotion_id: "promo_oja", item_id: "item_lantern", amount: 200, is_tax_inclusive: false },
      { code: "GROCER10", promotion_id: "promo_grocer", item_id: "item_rice", amount: 500, is_tax_inclusive: false },
    ])
    expect(result.codes).toEqual(["OJA500", "GROCER10"])
  })

  it("takes delivery discounts from the operator's promotions only: delivery is Oja's", () => {
    const delivery = (code: string) =>
      ({ action: "addShippingMethodAdjustment", code, shipping_method_id: "sm_1", amount: 1500 }) as const
    const result = shopAdjustments({
      passes: [{ seller_id: null, actions: [delivery("FREEDELIVERY"), delivery("GROCER10")] }],
      owners,
      caps,
    })

    expect(result.shipping).toEqual([
      { code: "FREEDELIVERY", promotion_id: "promo_delivery", shipping_method_id: "sm_1", amount: 1500 },
    ])
    expect(result.codes).toEqual(["FREEDELIVERY"])
  })

  it("never discounts an item below nothing when two promotions stack on it", () => {
    const result = shopAdjustments({
      passes: [
        { seller_id: null, actions: [item("OJA500", "item_lantern", 3000)] },
        { seller_id: "sel_gadget", actions: [item("GADGET5", "item_lantern", 2000)] },
      ],
      owners,
      caps,
    })

    expect(result.items.map((a) => [a.code, a.amount])).toEqual([
      ["OJA500", 3000],
      ["GADGET5", 1000],
    ])
  })

  it("says which of its promotions were used up", () => {
    const result = shopAdjustments({
      passes: [
        { seller_id: null, actions: [{ action: "promotionLimitExceeded", code: "OJA500" }] },
        { seller_id: "sel_grocer", actions: [{ action: "campaignBudgetExceeded", code: "GROCER10" }] },
        { seller_id: "sel_gadget", actions: [{ action: "campaignBudgetExceeded", code: "GROCER10" }] },
      ],
      owners,
      caps,
    })

    expect(result.items).toEqual([])
    expect(result.used_up).toEqual(["OJA500", "GROCER10"])
  })
})

// A code the buyer can't use says why (#6).
describe("promoCodeProblem", () => {
  const now = new Date("2026-10-14T12:00:00Z")
  const promotion = {
    code: "GROCER10",
    status: "active" as const,
    limit: null,
    used: 0,
    campaign: null,
  }
  const campaign = (c: object) => ({ starts_at: null, ends_at: null, budget: null, ...c })

  it("is none for a running promotion", () => {
    expect(promoCodeProblem(promotion, "grocer10", now)).toBeNull()
    expect(promoCodeProblem({ ...promotion, campaign: campaign({ ends_at: "2026-10-15T00:00:00Z" }) }, "GROCER10", now)).toBeNull()
  })

  it("says a code that doesn't exist, or isn't running yet as a draft, isn't valid", () => {
    expect(promoCodeProblem(null, "NOPE", now)).toEqual({
      code: "promo_code_not_found",
      message: '"NOPE" isn\'t a valid promo code. Check it and try again.',
    })
    expect(promoCodeProblem({ ...promotion, status: "draft" }, "grocer10", now)).toEqual({
      code: "promo_code_not_found",
      message: '"GROCER10" isn\'t a valid promo code. Check it and try again.',
    })
  })

  it("says an ended or stopped promotion has expired", () => {
    const expired = { code: "promo_code_expired", message: '"GROCER10" has expired.' }
    expect(promoCodeProblem({ ...promotion, campaign: campaign({ ends_at: "2026-10-14T11:59:59Z" }) }, "GROCER10", now)).toEqual(
      expired
    )
    expect(promoCodeProblem({ ...promotion, status: "inactive" }, "GROCER10", now)).toEqual(expired)
  })

  it("says a promotion that hasn't started isn't on yet", () => {
    expect(promoCodeProblem({ ...promotion, campaign: campaign({ starts_at: "2026-10-20T00:00:00Z" }) }, "GROCER10", now)).toEqual({
      code: "promo_code_not_started",
      message: '"GROCER10" isn\'t on yet.',
    })
  })

  it("says a promotion or campaign used to its limit is used up", () => {
    const usedUp = { code: "promo_code_used_up", message: '"GROCER10" has been used up.' }
    expect(promoCodeProblem({ ...promotion, limit: 100, used: 100 }, "GROCER10", now)).toEqual(usedUp)
    expect(
      promoCodeProblem({ ...promotion, campaign: campaign({ budget: { type: "usage", limit: 50, used: 50 } }) }, "GROCER10", now)
    ).toEqual(usedUp)
    expect(
      promoCodeProblem({ ...promotion, campaign: campaign({ budget: { type: "spend", limit: 10000, used: 10000 } }) }, "GROCER10", now)
    ).toEqual(usedUp)
  })
})
