import { dateLabel } from "./date-label"
import { deliveryEstimate, type OrderDelivery } from "./delivery"
import { openingLabel } from "./shop-hours"

/** What the confirmation reads from each shop's new order. */
export type PlacedOrder = {
  id: string
  seller: { name: string }
  /** When a shop closed at checkout next opens (ADR 0004); null while it is open. */
  shop_opens: { at: string; time_zone: string } | null
  delivery: OrderDelivery | null
  /** Set for a pickup order; only its presence matters here. */
  pickup: object | null
}

/** One step of what happens next: what, when in words, and the day ("Today", "Mon", or none yet). */
export type PlacedStep = { key: string; title: string; detail: string; day: string | null; now: boolean }

/**
 * What happens after paying, shop by shop: it accepts (now), prepares when it opens (a closed
 * shop), then its delivery arrives as checkout quoted it, or the buyer collects it once it's ready.
 */
export function orderPlacedSteps(orders: readonly PlacedOrder[], now: Date): PlacedStep[] {
  return orders.flatMap((order) => {
    const shop = order.seller.name
    const steps: PlacedStep[] = [{ key: `${order.id}-accepts`, title: `${shop} accepts`, detail: "Waiting for the shop", day: "Today", now: true }]
    if (order.shop_opens) {
      const { at, time_zone } = order.shop_opens
      steps.push({
        key: `${order.id}-opens`,
        title: `${shop} prepares your order`,
        detail: `When it opens, ${openingLabel(at, now, time_zone)}`,
        day: dateLabel(at, time_zone, { date: false }),
        now: false,
      })
    }
    if (order.delivery) {
      const { delivery_eta_time, time_zone } = order.delivery
      steps.push({
        key: `${order.id}-arrives`,
        title: `${shop}'s order arrives`,
        detail: `${deliveryEstimate(delivery_eta_time, now, time_zone)}, by the courier you chose`,
        day: dateLabel(delivery_eta_time, time_zone, { date: false }),
        now: false,
      })
    } else if (order.pickup) {
      steps.push({
        key: `${order.id}-collect`,
        title: `Collect from ${shop}`,
        detail: "Once it's ready, your pickup code is in Orders",
        day: null,
        now: false,
      })
    }
    return steps
  })
}
