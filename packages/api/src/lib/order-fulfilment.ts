import { acceptDeadline, newFulfilment, type Fulfilment, type FulfilmentState } from "@oja/domain"
import type { InferTypeOf, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ORDER_FULFILMENT_MODULE, type OrderFulfilmentModuleService } from "../modules/order-fulfilment"
import type OrderFulfilment from "../modules/order-fulfilment/models/order-fulfilment"
import type OrderRefund from "../modules/order-fulfilment/models/order-refund"
import type { OrderMoney } from "./order-refund"
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
/**
 * Emitted when the courier's pickup of a packed order is scheduled, with `{ id }` (the order).
 * Label booking (#24) emits it; the shop is pushed to have the parcel ready.
 */
export const ORDER_PICKUP_SCHEDULED = "order_fulfilment.pickup_scheduled"

export const fulfilmentService = (scope: Scope) => scope.resolve<OrderFulfilmentModuleService>(ORDER_FULFILMENT_MODULE)

/** How many of each line staff have picked, by line item id; a line not listed has none. */
export type Picks = Record<string, number>

export type FulfilmentRecord = {
  id: string
  order_id: string
  state: FulfilmentState
  fulfilment: Fulfilment
  placed_at: Date
  reject_reason: string | null
  picks: Picks | null
  accept_reminded_at: Date | null
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

/** What staff see of an order's fulfilment: its state, and while it is New, when it must be accepted by. */
export type FulfilmentView = {
  state: FulfilmentState
  /** ISO 8601; only while the order waits to be accepted. */
  accept_by: string | null
  rejected_by: "seller" | "accept_deadline" | null
  reject_reason: string | null
}

export function fulfilmentView(record: FulfilmentRecord | undefined, placedAt: Date | string): FulfilmentView {
  const fulfilment = record?.fulfilment ?? newFulfilment()
  return {
    state: fulfilment.state,
    accept_by: fulfilment.state === "new" ? acceptDeadline(new Date(placedAt).toISOString()) : null,
    rejected_by: fulfilment.state === "rejected" ? fulfilment.rejectedBy : null,
    reject_reason: record?.reject_reason ?? null,
  }
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

/** What staff see of each order's fulfilment. */
export async function fulfilmentViews(scope: Scope, orderIds: string[]): Promise<Map<string, FulfilmentView>> {
  if (!orderIds.length) return new Map()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({ entity: "order", fields: ["id", "created_at"], filters: { id: orderIds } })
  const records = await fulfilmentsOf(scope, orderIds)
  return new Map(
    (orders as { id: string; created_at: Date | string }[]).map((o) => [o.id, fulfilmentView(records.get(o.id), o.created_at)])
  )
}
