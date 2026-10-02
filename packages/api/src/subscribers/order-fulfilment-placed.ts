import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { OrderWorkflowEvents } from "@medusajs/framework/utils"
import { recordPlacedOrderWorkflow } from "../workflows/order-fulfilment/workflows/record-placed-order"

/** Each placed order starts New, so the accept-deadline job can find it. */
export default async function orderFulfilmentPlacedHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  await recordPlacedOrderWorkflow(container).run({ input: { order_id: event.data.id } })
}

export const config: SubscriberConfig = { event: OrderWorkflowEvents.PLACED }
