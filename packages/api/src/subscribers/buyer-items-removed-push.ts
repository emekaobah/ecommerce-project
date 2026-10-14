import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { pushItemsRemoved } from "../lib/buyer-notifications"
import { ORDER_ITEMS_REMOVED, type Picks } from "../lib/order-fulfilment"

/** Pushes the buyer that a shop removed items it didn't have from their order, and their refund (#5, #22). */
export default async function buyerItemsRemovedPushHandler({
  event,
  container,
}: SubscriberArgs<{ id: string; amount: number; removed: Picks; at: string }>) {
  await pushItemsRemoved(container, event.data)
}

export const config: SubscriberConfig = {
  event: ORDER_ITEMS_REMOVED,
  context: { subscriberId: "buyer-items-removed-push" },
}
