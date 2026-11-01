import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import type { FulfilmentState } from "@oja/domain"
import { startBuyerActivity } from "../lib/buyer-live-activity"
import { pushOrderState, tellReadyForPickup } from "../lib/buyer-notifications"
import { ORDER_STATE_CHANGED } from "../lib/order-fulfilment"

/**
 * Pushes the buyer as a shop's order reaches a state they are told about (#5); Ready for pickup
 * is emailed too (#33). An accepted order also starts its Live Activity (#143), whose alert can
 * stand in for the push on an iPhone.
 */
export default async function buyerOrderStatePushHandler({ event, container }: SubscriberArgs<{ id: string; state: FulfilmentState }>) {
  const { id, state } = event.data
  if (state === "ready_for_pickup") await tellReadyForPickup(container, id)
  else if (state === "accepted") await pushOrderState(container, id, state, { except: await startBuyerActivity(container, id) })
  else await pushOrderState(container, id, state)
}

export const config: SubscriberConfig = {
  event: ORDER_STATE_CHANGED,
  context: { subscriberId: "buyer-order-state-push" },
}
