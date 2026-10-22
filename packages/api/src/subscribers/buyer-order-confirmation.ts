import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { OrderGroupWorkflowEvents } from "@mercurjs/core/workflows"
import { confirmCheckout } from "../lib/buyer-notifications"
import { recordPlacedOrderWorkflow } from "../workflows/order-fulfilment/workflows/record-placed-order"

/**
 * Confirms a paid checkout to its buyer (#5), by email and push. Mercur creates the order group
 * once Paystack's webhook has captured the payment (ADR 0003). Its orders are recorded first:
 * `order.placed` records each too, but may not have yet, and an order not recorded isn't shown
 * to its buyer (#58). Recording is idempotent, so whichever comes second changes nothing.
 */
export default async function buyerOrderConfirmationHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order_group_order", fields: ["order_id"], filters: { order_group_id: event.data.id } })
  for (const { order_id } of data as unknown as { order_id: string }[]) {
    await recordPlacedOrderWorkflow(container).run({ input: { order_id } })
  }
  await confirmCheckout(container, event.data.id)
}

export const config: SubscriberConfig = {
  event: OrderGroupWorkflowEvents.CREATED,
  context: { subscriberId: "buyer-order-confirmation" },
}
