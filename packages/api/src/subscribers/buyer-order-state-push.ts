import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import type { FulfilmentState } from "@oja/domain"
import { pushOrderState, tellReadyForPickup } from "../lib/buyer-notifications"
import { ORDER_STATE_CHANGED } from "../lib/order-fulfilment"

/**
 * Pushes the buyer as a shop's order reaches a state they are told about (#5); Ready for pickup
 * is emailed too (#33).
 */
export default async function buyerOrderStatePushHandler({ event, container }: SubscriberArgs<{ id: string; state: FulfilmentState }>) {
  const { id, state } = event.data
  if (state === "ready_for_pickup") await tellReadyForPickup(container, id)
  else await pushOrderState(container, id, state)
}

export const config: SubscriberConfig = {
  event: ORDER_STATE_CHANGED,
  context: { subscriberId: "buyer-order-state-push" },
}
