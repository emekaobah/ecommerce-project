import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import type { HoldReminder } from "@oja/domain"
import { remindOfPickupHold, tellNotCollected, tellOrderCollected } from "../lib/buyer-notifications"
import { ORDER_COLLECTED, ORDER_NOT_COLLECTED, ORDER_PICKUP_HOLD_REMINDER, type Picks } from "../lib/order-fulfilment"

type PickupEvent =
  | { id: string }
  | { id: string; reminder: HoldReminder; at: string }
  | { id: string; amount: number; refunded: Picks; kept: Picks }

/**
 * Tells the buyer of a pickup order (#33), by email and push: their receipt once collected, a
 * reminder half-way through its hold and on its last day, and what is refunded once not collected.
 */
export default async function buyerPickupNotificationsHandler({ event, container }: SubscriberArgs<PickupEvent>) {
  const data = event.data
  if (event.name === ORDER_COLLECTED) await tellOrderCollected(container, data.id)
  else if (event.name === ORDER_PICKUP_HOLD_REMINDER && "reminder" in data) await remindOfPickupHold(container, data)
  else if (event.name === ORDER_NOT_COLLECTED && "kept" in data) await tellNotCollected(container, data)
}

export const config: SubscriberConfig = {
  event: [ORDER_COLLECTED, ORDER_PICKUP_HOLD_REMINDER, ORDER_NOT_COLLECTED],
  context: { subscriberId: "buyer-pickup-notifications" },
}
