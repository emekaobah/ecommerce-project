import { model } from "@medusajs/framework/utils"
import { PAYSTACK_REFUND_STATUSES } from "../../paystack/client"

/** What a refund is of: an order's items, or its delivery fee. */
export const REFUND_COVERS = ["items", "delivery"] as const
export type RefundCovers = (typeof REFUND_COVERS)[number]

/**
 * A refund of an order's share of its payment, and Paystack's word on it (#20). Also a whole
 * Paystack transaction no order claims (a page the buyer had replaced, or a checkout that
 * never became orders), refunded with no order: `order_id` is then null. Paystack
 * refunds asynchronously: a refund is `pending`, then `processing`, then `processed`, or it
 * `failed` (Paystack credited the money back to us) or `needs-attention` (it must be retried
 * with the buyer's bank account).
 */
const OrderRefund = model
  .define("order_refund", {
    id: model.id({ prefix: "ordref" }).primaryKey(),
    order_id: model.text().nullable(),
    /** Medusa's payment refunded; none for a transaction Medusa never recorded a payment for. */
    payment_id: model.text().nullable(),
    /** Medusa's refund on the payment. Gone once the refund failed: it no longer counts as refunded. */
    refund_id: model.text().unique().nullable(),
    amount: model.bigNumber(),
    /**
     * What the refund is of (#22): the order's items, which comes off its shop's payout, or its
     * delivery fee, which Oja keeps and so bears the refund of. Only Oja's staff refund delivery.
     */
    covers: model.enum([...REFUND_COVERS]).default("items"),
    currency_code: model.text(),
    /** The Paystack transaction refunded, which Paystack's `refund.*` webhooks name. */
    transaction_reference: model.text(),
    /** Paystack's id for the refund, to fetch its status by. */
    paystack_refund_id: model.text().nullable(),
    status: model.enum([...PAYSTACK_REFUND_STATUSES]).default("pending"),
  })
  .indexes([{ on: ["order_id"] }, { on: ["transaction_reference"] }])

export default OrderRefund
