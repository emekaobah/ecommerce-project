import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { OrderWorkflowEvents } from "@medusajs/framework/utils"
import { ORDER_ACCEPT_DEADLINE_NEAR, ORDER_PICKUP_SCHEDULED } from "../lib/order-fulfilment"
import { pushToShop, type ShopPushKind } from "../lib/shop-push"

const KIND_OF_EVENT: Record<string, ShopPushKind> = {
  [OrderWorkflowEvents.PLACED]: "order_placed",
  [ORDER_ACCEPT_DEADLINE_NEAR]: "accept_deadline_near",
  [ORDER_PICKUP_SCHEDULED]: "pickup_scheduled",
}

/** `at` (ISO 8601) is when the event happened, where it says: the time left to accept counts from it. */
type OrderEvent = { id: string; at?: string }

/** Pushes to the shop's staff about a new order, its accept deadline nearing, and a courier pickup scheduled (#27). */
export default async function shopOrderPushHandler({ event, container }: SubscriberArgs<OrderEvent>) {
  const kind = KIND_OF_EVENT[event.name]
  if (kind) await pushToShop(container, kind, event.data.id, event.data.at ? new Date(event.data.at) : new Date())
}

export const config: SubscriberConfig = {
  event: Object.keys(KIND_OF_EVENT),
  context: { subscriberId: "shop-order-push" },
}
