import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { OrderGroupWorkflowEvents } from "@mercurjs/core/workflows"
import { confirmCheckout } from "../lib/buyer-notifications"

/**
 * Confirms a paid checkout to its buyer (#5), by email and push. Mercur creates the order group
 * once Paystack's webhook has captured the payment (ADR 0003).
 */
export default async function buyerOrderConfirmationHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  await confirmCheckout(container, event.data.id)
}

export const config: SubscriberConfig = {
  event: OrderGroupWorkflowEvents.CREATED,
  context: { subscriberId: "buyer-order-confirmation" },
}
