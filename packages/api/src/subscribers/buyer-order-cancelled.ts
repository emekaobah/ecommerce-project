import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { tellOrderCancelled } from "../lib/buyer-notifications"
import { ORDER_CANCELLED } from "../lib/order-fulfilment"

/** Tells the buyer by push and email that an accepted order was cancelled, why, and their refund (#5, #17). */
export default async function buyerOrderCancelledHandler({ event, container }: SubscriberArgs<{ id: string; amount: number }>) {
  await tellOrderCancelled(container, event.data)
}

export const config: SubscriberConfig = {
  event: ORDER_CANCELLED,
  context: { subscriberId: "buyer-order-cancelled" },
}
