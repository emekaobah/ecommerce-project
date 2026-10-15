import { ojaFundedDiscount, ojaShareOf } from "../lib/discount-funding"

// Who pays for a discount (#6): a shop's own promotion comes out of its payout; one the operator
// runs is Oja's unless the operator said otherwise on the promotion (Mercur's "cost bearer").
describe("ojaShareOf", () => {
  it("is none of a shop's own promotion", () => {
    expect(ojaShareOf({ sellerId: "sel_1", cost: null })).toBe(0)
  })

  it("is all of the operator's promotion", () => {
    expect(ojaShareOf({ sellerId: null, cost: null })).toBe(100)
  })

  it("follows who the operator set to cover it", () => {
    expect(ojaShareOf({ sellerId: null, cost: { cost_bearer: "store", shared_marketplace_percentage: null } })).toBe(0)
    expect(ojaShareOf({ sellerId: "sel_1", cost: { cost_bearer: "marketplace", shared_marketplace_percentage: null } })).toBe(100)
    expect(ojaShareOf({ sellerId: null, cost: { cost_bearer: "shared", shared_marketplace_percentage: 40 } })).toBe(40)
  })

  it("counts a shared cost without a share as the shop's", () => {
    expect(ojaShareOf({ sellerId: null, cost: { cost_bearer: "shared", shared_marketplace_percentage: null } })).toBe(0)
  })
})

describe("ojaFundedDiscount", () => {
  const shares = new Map([
    ["promo_oja", 100],
    ["promo_shop", 0],
    ["promo_half", 50],
  ])

  it("is Oja's share of each discount on the order's lines", () => {
    expect(
      ojaFundedDiscount(
        [
          { quantity: 2, removed: 0, tax_rate: 0, adjustments: [{ amount: 400, is_tax_inclusive: true, promotion_id: "promo_oja" }] },
          {
            quantity: 1,
            removed: 0,
            tax_rate: 0,
            adjustments: [
              { amount: 300, is_tax_inclusive: true, promotion_id: "promo_shop" },
              { amount: 100, is_tax_inclusive: true, promotion_id: "promo_half" },
            ],
          },
        ],
        shares
      )
    ).toBe(450)
  })

  it("covers only the units the buyer kept: a line's discount is for the units it was placed with", () => {
    // Placed with 4, one removed as unavailable (#22): Oja funds 3 of the 4 units' discount.
    expect(
      ojaFundedDiscount([{ quantity: 3, removed: 1, tax_rate: 0, adjustments: [{ amount: 400, is_tax_inclusive: true, promotion_id: "promo_oja" }] }], shares)
    ).toBe(300)
    expect(
      ojaFundedDiscount([{ quantity: 0, removed: 2, tax_rate: 0, adjustments: [{ amount: 400, is_tax_inclusive: true, promotion_id: "promo_oja" }] }], shares)
    ).toBe(0)
  })

  it("counts what each discount took off the line, VAT included, whether or not its amount includes VAT", () => {
    // ₦200 off before 7.5% VAT is ₦215 off what the buyer paid; Oja funds the half-funded one's half.
    expect(
      ojaFundedDiscount(
        [
          {
            quantity: 1,
            removed: 0,
            tax_rate: 7.5,
            adjustments: [
              { amount: 200, is_tax_inclusive: false, promotion_id: "promo_oja" },
              { amount: 215, is_tax_inclusive: true, promotion_id: "promo_half" },
            ],
          },
        ],
        shares
      )
    ).toBe(322.5)
  })

  it("counts a discount whose funding wasn't recorded as the shop's", () => {
    expect(
      ojaFundedDiscount([{ quantity: 1, removed: 0, tax_rate: 0, adjustments: [{ amount: 400, is_tax_inclusive: true, promotion_id: "promo_other" }] }], shares)
    ).toBe(0)
  })

  it("rounds to the kobo", () => {
    expect(
      ojaFundedDiscount([{ quantity: 1, removed: 2, tax_rate: 0, adjustments: [{ amount: 100, is_tax_inclusive: true, promotion_id: "promo_oja" }] }], shares)
    ).toBe(33.33)
  })
})
