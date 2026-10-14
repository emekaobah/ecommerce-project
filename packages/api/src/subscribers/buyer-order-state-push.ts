import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import type { FulfilmentState } from "@oja/domain"
import { pushOrderState } from "../lib/buyer-notifications"
import { ORDER_STATE_CHANGED } from "../lib/order-fulfilment"

/** Pushes the buyer as a shop's order reaches a state they are told about (#5). */
export default async function buyerOrderStatePushHandler({ event, container }: SubscriberArgs<{ id: string; state: FulfilmentState }>) {
  await pushOrderState(container, event.data.id, event.data.state)
}

export const config: SubscriberConfig = {
  event: ORDER_STATE_CHANGED,
  context: { subscriberId: "buyer-order-state-push" },
}
