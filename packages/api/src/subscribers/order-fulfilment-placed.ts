import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { OrderWorkflowEvents } from "@medusajs/framework/utils"
import { startShopActivity } from "../lib/vendor-live-activity"
import { recordPlacedOrderWorkflow } from "../workflows/order-fulfilment/workflows/record-placed-order"

/**
 * Each placed order starts New, so the accept-deadline job can find it. The shop's Live Activity
 * starts after that, so the order is in the counts and the deadline it shows.
 */
export default async function orderFulfilmentPlacedHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  await recordPlacedOrderWorkflow(container).run({ input: { order_id: event.data.id } })
  await startShopActivity(container, event.data.id)
}

export const config: SubscriberConfig = { event: OrderWorkflowEvents.PLACED }
