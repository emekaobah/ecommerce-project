import { model } from "@medusajs/framework/utils"
import { PAYSTACK_REFUND_STATUSES } from "../../paystack/client"

/**
 * What a refund is of: an order's items, its delivery fee, or all of what was paid, items and
 * delivery together (a rejected order's share, or a payment no order claims).
 */
export const REFUND_COVERS = ["items", "delivery", "all"] as const
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
     * A refund of all is of an order nobody is paid for. The default is for rows made before
     * refunds said what they cover; each refund made now says.
     */
    covers: model.enum([...REFUND_COVERS]).default("items"),
    currency_code: model.text(),
    /** The Paystack transaction refunded, which Paystack's `refund.*` webhooks name. */
    transaction_reference: model.text(),
    /** Paystack's id for the refund, to fetch its status by. */
    paystack_refund_id: model.text().nullable(),
    status: model.enum([...PAYSTACK_REFUND_STATUSES]).default("pending"),
    /**
     * Why Paystack refused the refund (#16), such as "Insufficient balance". Such a refund was
     * never made: it is `failed` from the start, with no Medusa refund or Paystack refund id,
     * and counts as an attempt at what the order still owes its buyer (`lib/owed-refunds`).
     */
    failure_reason: model.text().nullable(),
    /**
     * When Paystack last said the refund needs attention (#13): it couldn't return the money to
     * the buyer's card and needs their bank account. The buyer is asked for one, reminded after
     * 1 and 3 days, and after 7 the refund is handed to Oja's team (`handed_over_at`).
     */
    needs_attention_at: model.dateTime().nullable(),
    /**
     * When a refund that needed attention was handed to Oja's team to send by hand (#13): the
     * buyer gave no bank account in 7 days. It still counts as refunded (Paystack holds the
     * money), but it no longer holds up the order's payout, and the order owes it to
     * its buyer by hand (`lib/owed-refunds`).
     */
    handed_over_at: model.dateTime().nullable(),
    /**
     * The bank the buyer had the refund retried to (#13), and the account number's last 4
     * digits, for support. The account number itself is never stored: it goes to Paystack only.
     */
    account_bank_name: model.text().nullable(),
    account_last4: model.text().nullable(),
  })
  .indexes([{ on: ["order_id"] }, { on: ["transaction_reference"] }])

export default OrderRefund
