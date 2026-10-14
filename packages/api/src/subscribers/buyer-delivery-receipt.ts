import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { emailDeliveryReceipt } from "../lib/buyer-notifications"
import { ORDER_DELIVERED } from "../lib/order-fulfilment"

/** Emails the buyer their receipt for a shop's order once it is delivered (#5). */
export default async function buyerDeliveryReceiptHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  await emailDeliveryReceipt(container, event.data.id)
}

export const config: SubscriberConfig = {
  event: ORDER_DELIVERED,
  context: { subscriberId: "buyer-delivery-receipt" },
}
