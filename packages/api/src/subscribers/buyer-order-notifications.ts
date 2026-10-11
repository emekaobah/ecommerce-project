import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import type { MedusaContainer } from "@medusajs/framework/types"
import { OrderGroupWorkflowEvents } from "@mercurjs/core/workflows"
import type { FulfilmentState } from "@oja/domain"
import { confirmCheckout, emailDeliveryReceipt, pushOrderState } from "../lib/buyer-notifications"
import { ORDER_DELIVERED, ORDER_STATE_CHANGED } from "../lib/order-fulfilment"

/** `id` is the order group for `order_group.created`, the order otherwise; `state` what it reached. */
type BuyerEvent = { id: string; state?: FulfilmentState }

const HANDLERS: Record<string, (container: MedusaContainer, data: BuyerEvent) => Promise<void>> = {
  // Mercur creates the order group once Paystack's webhook has captured the payment (ADR 0003).
  [OrderGroupWorkflowEvents.CREATED]: (container, { id }) => confirmCheckout(container, id),
  [ORDER_STATE_CHANGED]: (container, { id, state }) => (state ? pushOrderState(container, id, state) : Promise.resolve()),
  [ORDER_DELIVERED]: (container, { id }) => emailDeliveryReceipt(container, id),
}

/** Tells buyers about their orders (#5): confirmed once paid, each step a shop's order takes, and a receipt once delivered. */
export default async function buyerOrderNotificationsHandler({ event, container }: SubscriberArgs<BuyerEvent>) {
  await HANDLERS[event.name]?.(container, event.data)
}

export const config: SubscriberConfig = {
  event: Object.keys(HANDLERS),
  context: { subscriberId: "buyer-order-notifications" },
}
