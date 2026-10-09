import { model } from "@medusajs/framework/utils"

/**
 * An order paid out to its shop (#29), and how its payout was worked out (`payoutOf`): what
 * was captured for it, refunded of it, kept for delivery and taken as commission. One per order,
 * written before Paystack is asked to transfer, so an order is never paid twice. A transfer that
 * fails is tried again under a new attempt, up to `MAX_PAYOUT_ATTEMPTS`. The transfer itself,
 * and its status, is Mercur's payout.
 */
const ShopPayout = model
  .define("shop_payout", {
    id: model.id({ prefix: "shpay" }).primaryKey(),
    order_id: model.text(),
    /** 1 for the order's first payout, then one more for each retry after a failed transfer. */
    attempt: model.number().default(1),
    seller_id: model.text(),
    /** Mercur's payout: the transfer, and its status. None until Paystack took the transfer. */
    payout_id: model.text().unique().nullable(),
    currency_code: model.text(),
    paid: model.bigNumber(),
    refunded: model.bigNumber(),
    delivery: model.bigNumber(),
    commission: model.bigNumber(),
    /** What the shop was owed for the order when it was paid out. */
    amount: model.bigNumber(),
    /**
     * What this payout took back for refunds made after the shop's earlier payouts; below zero
     * when it gave back what was taken back too much.
     */
    recovered: model.bigNumber(),
    /** Ours, Paystack's reference for the transfer, which its `transfer.*` webhooks name. */
    transfer_reference: model.text().unique(),
  })
  .indexes([{ on: ["order_id", "attempt"], unique: true }, { on: ["seller_id"] }])

export default ShopPayout
