import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ORDER_REFUND_NEEDS_ATTENTION } from "../lib/order-fulfilment"
import { refundNeedsAttention } from "../lib/refund-accounts"

/** Asks the buyer for the bank account a refund needs (#13). */
export default async function refundNeedsAttentionHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  await refundNeedsAttention(container, event.data.id)
}

export const config: SubscriberConfig = {
  event: ORDER_REFUND_NEEDS_ATTENTION,
  context: { subscriberId: "refund-needs-attention" },
}
