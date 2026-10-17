import { model } from "@medusajs/framework/utils"

/** How Oja's team sent a refund by hand. */
export const SETTLEMENT_METHODS = ["bank_transfer", "other"] as const
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number]

/**
 * A refund an order owed its buyer that Oja's team settled by hand (#16), when Paystack
 * couldn't make it. The order still owes the amount in Medusa's order summary, which keeps it
 * off the shop's payout (`payoutOf`); what was settled is no longer retried
 * (`lib/owed-refunds`).
 */
const RefundSettlement = model
  .define("refund_settlement", {
    id: model.id({ prefix: "refset" }).primaryKey(),
    order_id: model.text(),
    amount: model.bigNumber(),
    currency_code: model.text(),
    method: model.enum([...SETTLEMENT_METHODS]),
    /** What was done, for the record: the transfer's reference, say. */
    note: model.text(),
    /** The operator (admin user) that settled it. */
    settled_by: model.text(),
  })
  .indexes([{ on: ["order_id"] }])

export default RefundSettlement
