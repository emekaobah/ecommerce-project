import type { FulfilmentState } from "./fulfilment"
import { formatMoney } from "./money"

/**
 * What a buyer's phone is told about their orders (#5): their checkout confirmed, and each step
 * of a shop's order they care about. The backend sends these; tapping one opens the order.
 */

/** A push's title and body. */
export type BuyerPush = { title: string; body: string }

/** One shop's order, as a push about it names it. */
export type BuyerPushOrder = {
  display_id: number
  shop: string
  rejected_by: "seller" | "accept_deadline" | null
}

/**
 * The push for each state a buyer is told about. The shop's own steps (picking, packing, the
 * courier confirming) aren't pushed; a state not listed sends nothing.
 */
const STATE_PUSHES: { [S in FulfilmentState]?: (order: BuyerPushOrder) => BuyerPush } = {
  accepted: ({ display_id, shop }) => ({
    title: `Order #${display_id} accepted`,
    body: `${shop} is preparing your order.`,
  }),
  label_booked: ({ display_id, shop }) => ({
    title: `Courier booked for order #${display_id}`,
    body: `${shop} has booked a courier to deliver your order.`,
  }),
  handed_to_courier: ({ display_id, shop }) => ({
    title: `Order #${display_id} picked up`,
    body: `The courier has collected your order from ${shop}.`,
  }),
  delivered: ({ display_id, shop }) => ({
    title: `Order #${display_id} delivered`,
    body: `Your order from ${shop} has arrived.`,
  }),
  rejected: ({ display_id, shop, rejected_by }) => ({
    title: `Order #${display_id} cancelled`,
    body: `${shop} ${rejected_by === "accept_deadline" ? "didn't accept your order in time" : "couldn't take your order"}. You'll get a full refund.`,
  }),
}

/** The push telling the buyer their order reached `state`, or null for a state they aren't pushed about. */
export function buyerStatusPush(state: FulfilmentState, order: BuyerPushOrder): BuyerPush | null {
  return STATE_PUSHES[state]?.(order) ?? null
}

/**
 * A shop in a confirmed checkout. `opens`: when a shop closed at checkout opens again (e.g.
 * "8am Tue"), so the order is prepared then (ADR 0004); null while it is open.
 */
export type ConfirmedShop = { name: string; opens: string | null }

/** What a shop closed at checkout means for its order. */
export const preparedWhenOpen = ({ name, opens }: ConfirmedShop & { opens: string }) =>
  `${name} is closed now: it prepares your order when it opens at ${opens}.`

/** The push confirming a paid checkout, split into an order per shop. */
export function orderConfirmedPush({ display_id, shops }: { display_id: number; shops: ConfirmedShop[] }): BuyerPush {
  const closed = shops.flatMap((shop) => (shop.opens ? [preparedWhenOpen({ ...shop, opens: shop.opens })] : []))
  const [only] = shops
  const next =
    shops.length === 1 && only ? `We'll let you know when ${only.name} accepts it.` : `We'll let you know as each of your ${shops.length} shops accepts it.`
  return { title: `Order #${display_id} confirmed`, body: closed.length ? closed.join(" ") : next }
}

/** A line the shop removed as unavailable while picking, and how many of it. */
export type RemovedItem = { title: string; quantity: number }

/**
 * The push telling the buyer a shop removed items it didn't have from their order, and what it
 * refunds for them (#22). Two lines are named; more are counted, to keep the push short.
 */
export function itemsRemovedPush({
  display_id,
  shop,
  items,
  refund,
  currency_code,
}: {
  display_id: number
  shop: string
  items: RemovedItem[]
  refund: number
  currency_code: string
}): BuyerPush {
  const units = items.reduce((sum, item) => sum + item.quantity, 0)
  const removed = items.length <= 2 ? items.map((item) => `${item.quantity} × ${item.title}`).join(" and ") : `${units} of your items`
  return {
    title: `Items removed from order #${display_id}`,
    body: `${shop} didn't have ${removed}. You'll be refunded ${formatMoney(refund, currency_code)}.`,
  }
}

/** The push telling the buyer a refund of their order has reached them (Paystack processed it). */
export function refundCompletedPush({
  display_id,
  shop,
  amount,
  currency_code,
}: {
  display_id: number
  shop: string
  amount: number
  currency_code: string
}): BuyerPush {
  return {
    title: `Refund for order #${display_id} completed`,
    body: `The refund of ${formatMoney(amount, currency_code)} from ${shop} has completed.`,
  }
}
