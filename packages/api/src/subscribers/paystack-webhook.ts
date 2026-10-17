import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { refundUnclaimedTransactionWorkflow } from "../workflows/order-fulfilment/workflows/refund-unclaimed-transaction"
import { syncOrderRefundsWorkflow } from "../workflows/order-fulfilment/workflows/sync-order-refunds"
import { syncPayoutTransfer } from "../lib/payouts"
import { placeOrRefundPaidSession } from "../lib/unplaced-checkout"

type WebhookReceived = {
  provider: string
  payload: { data?: { event?: string; data?: { reference?: string; transaction_reference?: string } } }
}

/**
 * What Mercur's payment webhook handling leaves to us (the route has checked the signature,
 * and each event is only a cue: Paystack's API is asked for the facts):
 * - `refund.*` (pending, processing, processed, failed, needs-attention) update the order
 *   refunds of the transaction they name.
 * - `charge.success` for a payment session that no longer exists, or for a different amount or
 *   currency than its session started, is a payment no order can claim, refunded in full.
 *   Mercur places the order for a live session; once it has, the cart is checked, and a paid
 *   cart that didn't become orders is tried again, then refunded (#38).
 * - `transfer.*` (success, failed, reversed) update the order payout the transfer pays (#29):
 *   Paystack sends an account's every webhook to this one URL.
 */
export default async function paystackWebhookHandler({ event, container }: SubscriberArgs<WebhookReceived>) {
  const { provider, payload } = event.data
  const name = payload.data?.event
  const data = payload.data?.data
  if (provider !== "paystack_paystack" || !name || !data) return
  if (name.startsWith("refund.") && data.transaction_reference) {
    await syncOrderRefundsWorkflow(container).run({ input: { transaction_reference: data.transaction_reference } })
  }
  if (name.startsWith("transfer.") && data.reference) {
    await syncPayoutTransfer(container, data.reference)
  }
  if (name === "charge.success" && data.reference) {
    const { result } = await refundUnclaimedTransactionWorkflow(container).run({ input: { reference: data.reference } })
    if (result.live_session_id) await placeOrRefundPaidSession(container, result.live_session_id)
  }
}

// Mercur's `/hooks/payment/:provider` route emits this for every payment webhook.
export const config: SubscriberConfig = { event: "mercur.payment.webhook_received" }
