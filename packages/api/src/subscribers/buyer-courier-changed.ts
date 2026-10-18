import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { tellCourierChanged } from "../lib/buyer-notifications"
import { ORDER_LABEL_BOOKED } from "../lib/order-fulfilment"

/** Tells the buyer by push and email when their order's label was booked with another courier than they chose (#19). */
export default async function buyerCourierChangedHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  await tellCourierChanged(container, event.data.id)
}

export const config: SubscriberConfig = {
  event: ORDER_LABEL_BOOKED,
  context: { subscriberId: "buyer-courier-changed" },
}
