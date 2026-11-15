import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ORDER_ACCEPT_DEADLINE_NEAR } from "../lib/order-fulfilment"
import { alertDeadlineNear } from "../lib/vendor-live-activity"

/**
 * An order entered its last two hours to accept: the shop's Live Activity updates at once, with an
 * alert. It's the same moment as the reminder push, marked once per order by `accept_reminded_at`.
 */
export default async function shopActivityDeadlineNearHandler({ event, container }: SubscriberArgs<{ id: string; at?: string }>) {
  await alertDeadlineNear(container, event.data.id, event.data.at ? new Date(event.data.at) : new Date())
}

export const config: SubscriberConfig = {
  event: ORDER_ACCEPT_DEADLINE_NEAR,
  context: { subscriberId: "shop-activity-deadline-near" },
}
