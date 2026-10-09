import {
  acceptDeadline,
  fulfilmentTimeline,
  newFulfilment,
  type Fulfilment,
  type FulfilmentState,
  type Reached,
  type ShopHours,
  type TimelineStep,
} from "@oja/domain"
import type { InferTypeOf, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ORDER_FULFILMENT_MODULE, type OrderFulfilmentModuleService } from "../modules/order-fulfilment"
import type OrderFulfilment from "../modules/order-fulfilment/models/order-fulfilment"
import type OrderRefund from "../modules/order-fulfilment/models/order-refund"
import type { OrderMoney } from "./order-refund"
import { shopHoursOf } from "./shop-hours"
import type { OrderTransaction } from "./shop-order"

// A seller order's fulfilment (docs/design.md, "Order state machine"), and what staff see of it.

type Scope = Pick<MedusaContainer, "resolve">

/** Emitted when staff accept a new order, with `{ id }` (the order). */
export const ORDER_ACCEPTED = "order_fulfilment.accepted"
/** Emitted when a new order is rejected, by its shop or by the accept deadline, with `{ id, rejected_by }`. */
export const ORDER_REJECTED = "order_fulfilment.rejected"
/** Emitted when staff pack a picked order, ready for a courier label, with `{ id }` (the order). */
export const ORDER_PACKED = "order_fulfilment.packed"
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
 * Emitted once when staff and the courier have disagreed about an order's handover for too long
 * (#25), with `{ id, waiting_for }` (the order, and whose half is missing: `staff` or `courier`).
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
  /** When the owner was alerted that the handover's halves disagree (#25). */
  handover_alerted_at: Date | null
}

export type OrderRefundRecord = InferTypeOf<typeof OrderRefund>

/** A stored row, typed: the model keeps the fulfilment as untyped JSON. */
export const asFulfilmentRecord = (row: InferTypeOf<typeof OrderFulfilment>) => row as unknown as FulfilmentRecord

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
  state: FulfilmentState
  /**
   * ISO 8601; only while the order waits to be accepted. 24 of the shop's open hours after it
   * was placed (ADR 0004); also null while the shop is paused with no time set to reopen.
   */
  accept_by: string | null
  rejected_by: "seller" | "accept_deadline" | null
  reject_reason: string | null
  /** The courier label last booked for the order; `cancelled` once Shipbubble cancelled it, to rebook. */
  shipment: { waybill: string; courier_name: string | null; tracking_url: string; cancelled: boolean } | null
  /**
   * The handover to the courier, from the courier's confirmation on (null before): the staff
   * member who confirmed it and when, and when the courier reported picking it up (ISO 8601).
   */
  handover: { staff: { name: string | null; at: string } | null; picked_up_at: string | null } | null
  /** The order's steps as staff see them, done up to where it is. */
  timeline: TimelineStep[]
}

/** The handover's halves as the order records them, in whichever state it is. */
function handoverOf(fulfilment: Fulfilment) {
  return "handover" in fulfilment ? fulfilment.handover : null
}

/**
 * `hours`: the shop's, which the accept deadline counts in; null for a shop without hours.
 * `names`: members' names by id, for who handed the order over.
 */
export function fulfilmentView(
  record: FulfilmentRecord | undefined,
  placedAt: Date | string,
  hours: ShopHours | null,
  names = new Map<string, string>()
): FulfilmentView {
  const fulfilment = record?.fulfilment ?? newFulfilment()
  const shipment = record?.shipment
  const handover = handoverOf(fulfilment)
  const placed_at = new Date(placedAt).toISOString()
  return {
    state: fulfilment.state,
    accept_by: fulfilment.state === "new" ? acceptDeadline(new Date(placedAt).toISOString(), hours) : null,
    rejected_by: fulfilment.state === "rejected" ? fulfilment.rejectedBy : null,
    reject_reason: record?.reject_reason ?? null,
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
    timeline: fulfilmentTimeline({ state: fulfilment.state, placed_at, reached: record?.reached ?? {} }, "staff"),
  }
}

/** The names of the members who handed these orders over, by member id. */
export async function handoverNames(scope: Scope, records: Iterable<FulfilmentRecord>): Promise<Map<string, string>> {
  const ids = [...records].flatMap((r) => {
    const actor = handoverOf(r.fulfilment)?.staff?.actor
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
    transactions: (order.transactions ?? []).map((t) => ({ ...t, amount: Number(t.amount) })),
    paymentOfCapture: paymentOf("captures"),
    paymentOfRefund: paymentOf("refunds"),
  }
}

/** What staff see of each order's fulfilment, its accept deadline counted in its shop's open hours. */
export async function fulfilmentViews(scope: Scope, orderIds: string[]): Promise<Map<string, FulfilmentView>> {
  if (!orderIds.length) return new Map()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order", fields: ["id", "created_at", "seller.id"], filters: { id: orderIds } })
  const orders = data as { id: string; created_at: Date | string; seller?: { id: string } | null }[]
  const [records, hours] = await Promise.all([
    fulfilmentsOf(scope, orderIds),
    shopHoursOf(scope, orders.flatMap((o) => (o.seller ? [o.seller.id] : []))),
  ])
  const names = await handoverNames(scope, records.values())
  return new Map(
    orders.map((o) => [
      o.id,
      fulfilmentView(records.get(o.id), o.created_at, (o.seller && hours.get(o.seller.id)) || null, names),
    ])
  )
}

/** The shop each order was placed with. */
export async function sellersOfOrders(scope: Scope, orderIds: string[]): Promise<Map<string, string>> {
  if (!orderIds.length) return new Map()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order_seller", fields: ["order_id", "seller_id"], filters: { order_id: orderIds } })
  return new Map((data as { order_id: string; seller_id: string }[]).map((l) => [l.order_id, l.seller_id]))
}
