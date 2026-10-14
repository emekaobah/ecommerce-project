import { model } from "@medusajs/framework/utils"

/**
 * Who funds a promotion's discounts on an order (#6): Oja's share, as it stood when the order
 * was placed (`ojaShareOf`), so changing the promotion later doesn't change the order's payout.
 * One per promotion with a discount on the order's items.
 */
const DiscountFunding = model
  .define("discount_funding", {
    id: model.id({ prefix: "dfund" }).primaryKey(),
    order_id: model.text(),
    promotion_id: model.text(),
    code: model.text().nullable(),
    /** Oja's share of the promotion's discounts, in percent; the shop's is the rest. */
    oja_share: model.number(),
  })
  .indexes([{ on: ["order_id", "promotion_id"], unique: true }])

export default DiscountFunding
