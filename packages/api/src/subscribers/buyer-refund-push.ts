import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { pushRefundCompleted } from "../lib/buyer-notifications"
import { ORDER_REFUND_PROCESSED } from "../lib/order-fulfilment"

/** Pushes the buyer that a refund of their order has completed (#5). */
export default async function buyerRefundPushHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  await pushRefundCompleted(container, event.data.id)
}

export const config: SubscriberConfig = {
  event: ORDER_REFUND_PROCESSED,
  context: { subscriberId: "buyer-refund-push" },
}
