import { buyerActivityContent, type BuyerActivityContent, type FulfilmentState, type RemovedItem } from "@oja/domain"
import type { BuyerOrder } from "./buyer-orders"

// What a buyer's Lock Screen shows of a shop order, on an iPhone (`buyer-live-activity`) and on
// Android (`buyer-live-update`) alike.

export type ActivityState = Exclude<FulfilmentState, "new" | "rejected">
/** What only a cancelled or not collected order's own event knows. */
export type Ending = { refund?: number; kept?: RemovedItem[] }

export const contentOf = (number: string, order: BuyerOrder, state: ActivityState, { refund, kept }: Ending = {}): BuyerActivityContent =>
  buyerActivityContent({
    number,
    shop: order.seller.name,
    method: order.fulfilment.method,
    state,
    currency_code: order.currency_code,
    pickup_code: order.pickup?.code,
    cancellation: order.fulfilment.cancellation,
    refund: refund ?? order.refund?.amount ?? 0,
    kept,
  })

/** Where an order has been accepted and isn't finished: when a phone should be showing it. */
export const RUNS_AN_ACTIVITY = new Set<FulfilmentState>([
  "accepted",
  "picking",
  "partially_available",
  "packed",
  "label_booked",
  "courier_confirmed",
  "handed_to_courier",
  "in_transit",
  "ready_for_pickup",
])
