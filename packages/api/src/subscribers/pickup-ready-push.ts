import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ORDER_READY_FOR_PICKUP } from "../lib/order-fulfilment"
import { pushPickupReady } from "../lib/pickup-push"

/** Tells the buyer their pickup order is ready to collect (#12): the code is in the app. */
export default async function pickupReadyPushHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  await pushPickupReady(container, event.data.id)
}

export const config: SubscriberConfig = {
  event: ORDER_READY_FOR_PICKUP,
  context: { subscriberId: "pickup-ready-push" },
}
