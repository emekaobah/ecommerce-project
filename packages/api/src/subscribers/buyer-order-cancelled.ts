import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { endBuyerActivity } from "../lib/buyer-live-activity"
import { tellOrderCancelled } from "../lib/buyer-notifications"
import { ORDER_CANCELLED } from "../lib/order-fulfilment"

/** Tells the buyer by push and email that an accepted order was cancelled, why, and their refund (#5, #17), and ends its Live Activity saying the same (#144). */
export default async function buyerOrderCancelledHandler({ event, container }: SubscriberArgs<{ id: string; amount: number }>) {
  await Promise.all([tellOrderCancelled(container, event.data), endBuyerActivity(container, event.data.id, "cancelled", { refund: event.data.amount })])
}

export const config: SubscriberConfig = {
  event: ORDER_CANCELLED,
  context: { subscriberId: "buyer-order-cancelled" },
}
