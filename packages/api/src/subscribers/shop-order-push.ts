import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { OrderWorkflowEvents } from "@medusajs/framework/utils"
import { ORDER_ACCEPT_DEADLINE_NEAR, ORDER_HANDOVER_DISAGREEMENT, ORDER_NOT_COLLECTED, ORDER_PICKUP_SCHEDULED } from "../lib/order-fulfilment"
import { pushToShop, type ShopPushDetail, type ShopPushKind } from "../lib/shop-push"

const KIND_OF_EVENT: Record<string, ShopPushKind> = {
  [OrderWorkflowEvents.PLACED]: "new_order",
  [ORDER_ACCEPT_DEADLINE_NEAR]: "accept_deadline_near",
  [ORDER_PICKUP_SCHEDULED]: "pickup_scheduled",
  [ORDER_HANDOVER_DISAGREEMENT]: "handover_disagreement",
  [ORDER_NOT_COLLECTED]: "not_collected",
}

/**
 * `at` (ISO 8601) is when the event happened, where it says: the time left to accept counts from
 * it. `perishable_kept`: a pickup order not collected kept fresh lines for the shop.
 */
type OrderEvent = { id: string; at?: string } & ShopPushDetail

/**
 * Pushes to the shop's staff about a new order, its accept deadline nearing, and a courier
 * pickup scheduled (#27); to its owners about a disputed handover (#25); and to its owners and
 * managers about a pickup order not collected (#33).
 */
export default async function shopOrderPushHandler({ event, container }: SubscriberArgs<OrderEvent>) {
  const kind = KIND_OF_EVENT[event.name]
  const { id, at, waiting_for, perishable_kept } = event.data
  if (kind) await pushToShop(container, kind, id, at ? new Date(at) : new Date(), { waiting_for, perishable_kept })
}

export const config: SubscriberConfig = {
  event: Object.keys(KIND_OF_EVENT),
  context: { subscriberId: "shop-order-push" },
}
