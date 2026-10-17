import {
  acceptDeadline,
  fulfilmentTimeline,
  newFulfilment,
  type Cancellation,
  type Fulfilment,
  type FulfilmentMethod,
  type FulfilmentState,
  type HoldReminder,
  type Reached,
  type ShopHours,
  type TimelineStep,
} from "@oja/domain"
import type { InferTypeOf, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { isPickupMethod } from "./collection-point"
import { collectByOf, HOLD_LINE_FIELDS, holdLinesOf, type CollectBy, type HoldLine, type OrderLineRow } from "./pickup-hold"
import { ORDER_FULFILMENT_MODULE, type OrderFulfilmentModuleService } from "../modules/order-fulfilment"
import type OrderFulfilment from "../modules/order-fulfilment/models/order-fulfilment"
import type OrderRefund from "../modules/order-fulfilment/models/order-refund"
import type { OrderMoney } from "./order-refund"
import { shopHoursOf } from "./shop-hours"
import { transactionsOf, type OrderTransaction } from "./shop-order"

// A seller order's fulfilment (docs/design.md, "Order state machine"), and what staff see of it.

type Scope = Pick<MedusaContainer, "resolve">

/**
 * Emitted whenever an order's fulfilment moves to another state, by whatever trigger, with
 * `{ id, state }` (the order and the state it reached). The buyer is pushed about the states
 * they care about (#5).
 */
export const ORDER_STATE_CHANGED = "order_fulfilment.state_changed"
/**
 * Emitted when units staff found unavailable are removed from an order (#22), with
 * `{ id, amount, removed, at }`: the order, what the edit took off its total (which the buyer
 * is refunded), the units removed of each line by line item id, and when (ISO 8601).
 */
export const ORDER_ITEMS_REMOVED = "order_fulfilment.items_removed"
/** Emitted when Paystack has processed an order's refund, so the money has reached the buyer, with `{ id }` (the order refund). */
export const ORDER_REFUND_PROCESSED = "order_refund.processed"
/**
 * Emitted when Paystack says a refund needs attention (#13), with `{ id }` (the order refund):
 * it couldn't return the money to the card, and needs the buyer's bank account to retry.
 */
export const ORDER_REFUND_NEEDS_ATTENTION = "order_refund.needs_attention"
/** Emitted when staff accept a new order, with `{ id }` (the order). */
export const ORDER_ACCEPTED = "order_fulfilment.accepted"
/** Emitted when a new order is rejected, by its shop or by the accept deadline, with `{ id, rejected_by }`. */
export const ORDER_REJECTED = "order_fulfilment.rejected"
/**
 * Emitted when an accepted order is cancelled (#17), by its shop or by Oja's team, with
 * `{ id, amount }`: the order, and all that was left of its share, which its buyer is refunded.
 */
export const ORDER_CANCELLED = "order_fulfilment.cancelled"
/**
 * Emitted when staff pack a picked order, with `{ id }` (the order): a delivery order is then
 * ready for a courier label, a pickup order Ready for pickup with its code issued (#12).
 */
export const ORDER_PACKED = "order_fulfilment.packed"
/** Emitted when a pickup order is handed over at the counter, and so may be paid out (#12), with `{ id }` (the order). */
export const ORDER_COLLECTED = "order_fulfilment.collected"
/**
 * Emitted when a pickup order's hold ends uncollected (#32), with `{ id, amount, refunded, kept }`:
 * the order, what the edit took off its total (which its buyer is refunded), and the units of
 * each line refunded (its non-perishable lines) and kept for the shop (its perishable lines), by
 * line item id. Its buyer and the shop's owners and managers are told (#33).
 */
export const ORDER_NOT_COLLECTED = "order_fulfilment.not_collected"
/**
 * Emitted once for each reminder to the buyer of a pickup order still to collect (#33), with
 * `{ id, reminder, at }`: the order, `half_way` or `last_day`, and when it was due (ISO 8601).
 */
export const ORDER_PICKUP_HOLD_REMINDER = "order_fulfilment.pickup_hold_reminder"
/** Emitted once when a new order nears its accept deadline unaccepted, with `{ id }` (the order). */
export const ORDER_ACCEPT_DEADLINE_NEAR = "order_fulfilment.accept_deadline_near"
/** Emitted when staff book a courier label for a packed order, with `{ id }` (the order). */
export const ORDER_LABEL_BOOKED = "order_fulfilment.label_booked"
/** Emitted when Shipbubble cancels an order's shipment and the order is back to packed, with `{ id }` (the order). */
export const ORDER_SHIPMENT_CANCELLED = "order_fulfilment.shipment_cancelled"
/**
 * Emitted when the courier's pickup of a packed order is scheduled, with `{ id }` (the order):
 * when the courier confirms a booked label (#24). The shop is pushed to have the parcel ready.
 */
export const ORDER_PICKUP_SCHEDULED = "order_fulfilment.pickup_scheduled"
/** Emitted when an order is delivered, and so may be paid out to the shop (#25), with `{ id }` (the order). */
export const ORDER_DELIVERED = "order_fulfilment.delivered"
/**
 * Emitted when staff and the courier have disagreed about an order's handover for too long
 * (#25), and daily while they do, with `{ id, waiting_for, at }` (the order, whose half is missing:
 * `staff` or `courier`, and when the alert was raised).
 * The shop's owner is pushed to check it.
 */
export const ORDER_HANDOVER_DISAGREEMENT = "order_fulfilment.handover_disagreement"

export const fulfilmentService = (scope: Scope) => scope.resolve<OrderFulfilmentModuleService>(ORDER_FULFILMENT_MODULE)

/** How many of each line (picked, marked unavailable, removed), by line item id; a line not listed has none. */
export type Picks = Record<string, number>

/**
 * The courier shipment booked for an order (#24): Shipbubble's id for it, which is its waybill
 * number, and the Medusa fulfilment it was booked on. Kept once Shipbubble cancels it, so staff
 * see why the order is back to packed.
 */
export type Shipment = {
  waybill: string
  courier_name: string | null
  tracking_url: string
  fulfillment_id: string
  /** ISO 8601. */
  booked_at: string
  /** ISO 8601; when Shipbubble cancelled it. */
  cancelled_at: string | null
}

export type FulfilmentRecord = {
  id: string
  order_id: string
  state: FulfilmentState
  fulfilment: Fulfilment
  placed_at: Date
  reject_reason: string | null
  picks: Picks | null
  /** Units of each line marked unavailable, waiting to be removed from the order (#22). */
  unavailable: Picks | null
  /** Units of each line removed from the order as unavailable (#22). */
  removed: Picks | null
  accept_reminded_at: Date | null
  shipment: Shipment | null
  /** The shipment's waybill, for its webhooks to find the order by. */
  shipment_id: string | null
  /** When the order last reached each state; null for an order not moved since this was kept (#25). */
  reached: Reached | null
  /** When the order was delivered, and so may be paid out (#25). */
  payout_eligible_at: Date | null
  /** When the owner was last alerted that the handover's halves disagree (#25). */
  handover_alerted_at: Date | null
  /** A pickup order's code, from Ready for pickup on (#12); never shown to staff. */
  pickup_code: string | null
  /** When wrong pickup codes were tried on the order (ISO 8601). */
  pickup_code_attempts: string[] | null
  /** The last reminder the buyer of a pickup order still to collect had (#33). */
  hold_reminded: HoldReminder | null
}

export type OrderRefundRecord = InferTypeOf<typeof OrderRefund>

/** A stored row, typed: the model keeps the fulfilment as untyped JSON. */
export const asFulfilmentRecord = (row: InferTypeOf<typeof OrderFulfilment>) => row as unknown as FulfilmentRecord

/** When the owner was last alerted about the order's handover (ISO 8601), if ever. */
export const alertedAt = (row: Pick<FulfilmentRecord, "handover_alerted_at">) =>
  row.handover_alerted_at ? new Date(row.handover_alerted_at).toISOString() : null

/**
 * Whether the order was cancelled once accepted (#17): its buyer is owed all that is left of its
 * share, retried like any owed refund (#16). Not a rejected order, whose refund the accept-deadline
 * job retries (#20).
 */
export const cancelledOnceAccepted = (record: Pick<FulfilmentRecord, "state"> | undefined) => record?.state === "cancelled"

/**
 * Whether the order's buyer gets all of its share back and its shop is paid nothing for it: it
 * was rejected while New (#20) or cancelled once accepted (#17), Medusa's order `canceled` either way.
 */
export const givesShareBack = (record: Pick<FulfilmentRecord, "state"> | undefined) =>
  record?.state === "rejected" || cancelledOnceAccepted(record)

/** Each order's fulfilment row; an order without one is New. */
export async function fulfilmentsOf(scope: Scope, orderIds: string[]): Promise<Map<string, FulfilmentRecord>> {
  if (!orderIds.length) return new Map()
  const rows = (await fulfilmentService(scope).listOrderFulfilments({ order_id: orderIds })).map(asFulfilmentRecord)
  return new Map(rows.map((row) => [row.order_id, row]))
}

/** The fulfilment row of the order whose latest shipment this is (Shipbubble's id for it), if any. */
export async function orderOfShipment(scope: Scope, shipmentId: string): Promise<FulfilmentRecord | undefined> {
  const [row] = await fulfilmentService(scope).listOrderFulfilments({ shipment_id: shipmentId }, { take: 1 })
  return row ? asFulfilmentRecord(row) : undefined
}

/** What staff see of an order's fulfilment: its state, and while it is New, when it must be accepted by. */
export type FulfilmentView = {
  /** How the order reaches its buyer: by courier, or collected in store (#12). */
  method: FulfilmentMethod
  state: FulfilmentState
  /**
   * ISO 8601; only while the order waits to be accepted. 24 of the shop's open hours after it
   * was placed (ADR 0004); a pause that starts after it was placed doesn't stop the clock (#18).
   */
  accept_by: string | null
  rejected_by: "seller" | "accept_deadline" | null
  reject_reason: string | null
  /**
   * An accepted order cancelled (#17): by its shop (`seller`) or by Oja's team (`operator`), why,
   * the note given, and when (ISO 8601); null unless cancelled. Not who: staff and buyer alike see it.
   */
  cancellation: Omit<Cancellation, "actor"> | null
  /** The courier label last booked for the order; `cancelled` once Shipbubble cancelled it, to rebook. */
  shipment: { waybill: string; courier_name: string | null; tracking_url: string; cancelled: boolean } | null
  /**
   * The handover to the courier, from the courier's confirmation on (null before): the staff
   * member who confirmed it and when, and when the courier reported picking it up (ISO 8601).
   */
  handover: { staff: { name: string | null; at: string } | null; picked_up_at: string | null } | null
  /**
   * A pickup order's handover at the counter, once collected (#12): the staff member who checked
   * the code and when, and the name the collector gave.
   */
  collection: { staff: { name: string | null; at: string }; collected_by: string } | null
  /**
   * While a pickup order is Ready for pickup: when its hold ends (#32), closing time on the 5th
   * of the shop's open days after Ready (the next one for an order with perishable lines), and
   * the region's timezone to show it in. Null otherwise, and while the shop is paused with no
   * resume date (the hold's clock is frozen).
   */
  collect_by: CollectBy | null
  /** The order's steps as staff (or its buyer) see them, done up to where it is. */
  timeline: TimelineStep[]
}

/** The handover's halves as the order records them, in whichever state it is. */
function handoverOf(fulfilment: Fulfilment) {
  return "handover" in fulfilment ? fulfilment.handover : null
}

/** A collected pickup order's handover at the counter. */
function collectionOf(fulfilment: Fulfilment) {
  return "collection" in fulfilment ? fulfilment.collection : null
}

/** Who cancelled an accepted order, why and when; never which member or operator. */
function cancellationOf(fulfilment: Fulfilment): FulfilmentView["cancellation"] {
  if (fulfilment.state !== "cancelled") return null
  const { by, reason, note, at } = fulfilment.cancellation
  return { by, reason, note, at }
}

/** `names`: members' names by id, for who handed the order over; `audience`: whose steps the timeline shows. */
export type FulfilmentViewOptions = { names?: Map<string, string>; audience?: "buyer" | "staff" }

/**
 * The order a fulfilment view is of: when it was placed, how it was to reach its buyer, and the
 * lines still on it, which set a pickup order's hold (left out, no hold is counted).
 */
export type PlacedOrder = { placed_at: Date | string; method: FulfilmentMethod; lines?: HoldLine[] }

/**
 * `order`: an order without a row yet is New, by the method it was placed with. `hours`: the
 * shop's, which the accept deadline counts in; null for a shop without hours.
 */
export function fulfilmentView(
  record: FulfilmentRecord | undefined,
  order: PlacedOrder,
  hours: ShopHours | null,
  { names = new Map<string, string>(), audience = "staff" }: FulfilmentViewOptions = {}
): FulfilmentView {
  const fulfilment = record?.fulfilment ?? newFulfilment(order.method)
  const shipment = record?.shipment
  const handover = handoverOf(fulfilment)
  const collection = collectionOf(fulfilment)
  const placed_at = new Date(order.placed_at).toISOString()
  return {
    method: fulfilment.method,
    state: fulfilment.state,
    accept_by: fulfilment.state === "new" ? acceptDeadline(placed_at, hours) : null,
    rejected_by: fulfilment.state === "rejected" ? fulfilment.rejectedBy : null,
    collect_by: collectByOf(record, hours, order.lines),
    reject_reason: record?.reject_reason ?? null,
    cancellation: cancellationOf(fulfilment),
    shipment: shipment
      ? {
          waybill: shipment.waybill,
          courier_name: shipment.courier_name,
          tracking_url: shipment.tracking_url,
          cancelled: !!shipment.cancelled_at,
        }
      : null,
    handover: handover && {
      staff: handover.staff ? { name: names.get(handover.staff.actor) ?? null, at: handover.staff.at } : null,
      picked_up_at: handover.pickup?.at ?? null,
    },
    collection: collection && {
      staff: { name: names.get(collection.actor) ?? null, at: collection.at },
      collected_by: collection.collectedBy,
    },
    timeline: fulfilmentTimeline(
      { method: fulfilment.method, state: fulfilment.state, placed_at, reached: record?.reached ?? {} },
      audience
    ),
  }
}

/** The names of the members who handed these orders over, to a courier or at the counter, by member id. */
export async function handoverNames(scope: Scope, records: Iterable<FulfilmentRecord>): Promise<Map<string, string>> {
  const ids = [...records].flatMap((r) => {
    const actor = handoverOf(r.fulfilment)?.staff?.actor ?? collectionOf(r.fulfilment)?.actor
    return actor ? [actor] : []
  })
  if (!ids.length) return new Map()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "member", fields: ["id", "first_name", "last_name", "email"], filters: { id: ids } })
  type Member = { id: string; first_name?: string | null; last_name?: string | null; email?: string | null }
  return new Map(
    (data as Member[]).map((m) => [m.id, [m.first_name, m.last_name].filter(Boolean).join(" ") || (m.email ?? m.id)])
  )
}

type PaymentRow = {
  id: string
  currency_code: string
  data?: Record<string, unknown> | null
  captures?: { id: string }[] | null
  refunds?: { id: string }[] | null
}

/** The payments an order may have been paid by: its checkout's (on the cart Mercur split) and its own (#65). */
export async function paymentsOfOrder(scope: Scope, orderId: string): Promise<PaymentRow[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: links } = await query.graph({ entity: "order_cart", fields: ["cart_id"], filters: { order_id: orderId } })
  const { data: carts } = links.length
    ? await query.graph({
        entity: "cart",
        fields: ["payment_collection.payments.id"],
        filters: { id: links.map((l: { cart_id: string }) => l.cart_id) },
      })
    : { data: [] }
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["payment_collections.payments.id"],
    filters: { id: orderId },
  })
  type WithPayments = { payments?: ({ id: string } | null)[] | null } | null | undefined
  const ids = [
    ...carts.map((c: { payment_collection: WithPayments }) => c.payment_collection),
    ...(orders[0]?.payment_collections ?? []),
  ].flatMap((collection: WithPayments) => (collection?.payments ?? []).map((p) => p?.id))
  const paymentIds = [...new Set(ids.filter((id): id is string => !!id))]
  if (!paymentIds.length) return []
  const { data: payments } = await query.graph({
    entity: "payment",
    fields: ["id", "currency_code", "data", "captures.id", "refunds.id"],
    filters: { id: paymentIds },
  })
  return payments as PaymentRow[]
}

/** The order's own transactions, and which payment each of their captures and refunds belongs to. */
export async function orderMoney(scope: Scope, orderId: string, payments: PaymentRow[]): Promise<OrderMoney & { currency_code: string }> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "currency_code", "transactions.amount", "transactions.reference", "transactions.reference_id"],
    filters: { id: orderId },
  })
  const order = data[0] as { currency_code: string; transactions?: OrderTransaction[] | null }
  const paymentOf = (key: "captures" | "refunds") =>
    new Map(payments.flatMap((p) => (p[key] ?? []).map((item) => [item.id, p.id] as const)))
  return {
    currency_code: order.currency_code,
    transactions: transactionsOf(order),
    paymentOfCapture: paymentOf("captures"),
    paymentOfRefund: paymentOf("refunds"),
  }
}

/** What staff see of each order's fulfilment, its accept deadline counted in its shop's open hours. */
export async function fulfilmentViews(scope: Scope, orderIds: string[]): Promise<Map<string, FulfilmentView>> {
  if (!orderIds.length) return new Map()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "created_at", "seller.id", ...METHOD_FIELDS, ...HOLD_LINE_FIELDS],
    filters: { id: orderIds },
  })
  type Row = OrderWithMethods & { id: string; created_at: Date | string; seller?: { id: string } | null; items?: OrderLineRow[] | null }
  const orders = data as unknown as Row[]
  const [records, hours, lines] = await Promise.all([
    fulfilmentsOf(scope, orderIds),
    shopHoursOf(scope, orders.flatMap((o) => (o.seller ? [o.seller.id] : []))),
    holdLinesOf(scope, orders),
  ])
  const names = await handoverNames(scope, records.values())
  return new Map(
    orders.map((o) => [
      o.id,
      fulfilmentView(
        records.get(o.id),
        { placed_at: o.created_at, method: methodOfOrder(o), lines: lines.get(o.id) },
        (o.seller && hours.get(o.seller.id)) || null,
        { names }
      ),
    ])
  )
}

/** The order fields `methodOfOrder` reads. */
export const METHOD_FIELDS = ["shipping_methods.data"]
export type OrderWithMethods = { shipping_methods?: ({ data?: Record<string, unknown> | null } | null)[] | null }

/** How an order was placed to reach its buyer: collected when its shipping method is its shop's pickup (#12). */
export const methodOfOrder = (order: OrderWithMethods): FulfilmentMethod =>
  (order.shipping_methods ?? []).some(isPickupMethod) ? "pickup" : "delivery"

/** When the order was placed and how, to reach its buyer, read from the order itself; undefined for no such order. */
export async function placedOrderOf(scope: Scope, orderId: string): Promise<{ placed_at: Date; method: FulfilmentMethod } | undefined> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order", fields: ["created_at", ...METHOD_FIELDS], filters: { id: orderId } })
  const order = data[0] as unknown as (OrderWithMethods & { created_at: Date | string }) | undefined
  return order && { placed_at: new Date(order.created_at), method: methodOfOrder(order) }
}

/** The shop's orders Ready for pickup (#12), by when they became ready, longest waiting first. */
export async function readyForPickup(scope: Scope, sellerId: string): Promise<string[]> {
  const rows = (await fulfilmentService(scope).listOrderFulfilments({ state: "ready_for_pickup" })).map(asFulfilmentRecord)
  const sellers = await sellersOfOrders(scope, rows.map((r) => r.order_id))
  const readyAt = (r: FulfilmentRecord) => r.reached?.ready_for_pickup ?? ""
  return rows
    .filter((r) => sellers.get(r.order_id) === sellerId)
    .sort((a, b) => readyAt(a).localeCompare(readyAt(b)))
    .map((r) => r.order_id)
}

/** The shop each order was placed with. */
export async function sellersOfOrders(scope: Scope, orderIds: string[]): Promise<Map<string, string>> {
  if (!orderIds.length) return new Map()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order_seller", fields: ["order_id", "seller_id"], filters: { order_id: orderIds } })
  return new Map((data as { order_id: string; seller_id: string }[]).map((l) => [l.order_id, l.seller_id]))
}
