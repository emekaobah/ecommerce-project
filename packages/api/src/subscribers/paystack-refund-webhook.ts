import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { syncOrderRefundsWorkflow } from "../workflows/order-fulfilment/workflows/sync-order-refunds"

type WebhookReceived = { provider: string; payload: { data?: { event?: string; data?: { transaction_reference?: string } } } }

/**
 * Paystack's `refund.*` webhooks (pending, processing, processed, failed, needs-attention)
 * update the order refunds of the transaction they name. The route checked the signature;
 * the event is only a cue, as each refund's status is fetched from Paystack.
 */
export default async function paystackRefundWebhookHandler({ event, container }: SubscriberArgs<WebhookReceived>) {
  const { provider, payload } = event.data
  const reference = payload.data?.data?.transaction_reference
  if (provider !== "paystack_paystack" || !payload.data?.event?.startsWith("refund.") || !reference) return
  await syncOrderRefundsWorkflow(container).run({ input: { transaction_reference: reference } })
}

// Mercur's `/hooks/payment/:provider` route emits this for every payment webhook.
export const config: SubscriberConfig = { event: "mercur.payment.webhook_received" }
