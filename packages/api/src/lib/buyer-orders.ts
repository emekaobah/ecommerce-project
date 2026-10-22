import { canReview, shopStatus, type OrderDelivery, type ShopHours } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { PaystackRefundStatus } from "../modules/paystack/client"
import { SHIPBUBBLE_TIMEZONE, type ShipbubbleQuote } from "../modules/shipbubble"
import { collectionPlacesOf, type CollectionPlace } from "./collection-point"
import {
  fulfilmentService,
  fulfilmentsOf,
  fulfilmentView,
  METHOD_FIELDS,
  methodOfOrder,
  paymentsOfOrders,
  type FulfilmentRecord,
  type FulfilmentView,
  type Picks,
  type PlacedOrder,
  type Shipment,
  switchedFrom,
} from "./order-fulfilment"
import { refundMade, refusedByPaystack, totalOf } from "./order-refund"
import { failedSinceLastMade, handedOver, needsAccount, owedRefundsOf, type OwedRefund } from "./owed-refunds"
import { HOLD_LINE_FIELDS, holdLinesOf } from "./pickup-hold"
import { buyerReviews, subjectKey, type BuyerReview } from "./reviews"
import { shopHoursOf } from "./shop-hours"

// The buyer's order history (#17): each checkout is an order group, split into one order per
// shop. Mercur's `/store/order-groups` has neither each order's fulfilment and refund nor what
// was paid for it (a refund's credit line takes it off `total`), keeps no order, and its default
// fields nest deeper than Medusa allows a store route (a 400 unless `fields` is given), so the
// buyer's view is read here.

type Scope = Pick<MedusaContainer, "resolve">

export type BuyerOrderItem = {
  id: string
  product_id: string | null
  product_title: string | null
  /** The variant bought, so Order again can find its offer today. */
  variant_id: string | null
  variant_title: string | null
  thumbnail: string | null
  /** How many are on the order now. */
  quantity: number
  /** How many the shop removed as unavailable while picking, and refunded (#22). */
  unavailable_quantity: number
  unit_price: number
  total: number
}

/** One shop's order of a checkout, as its buyer sees it. */
export type BuyerOrder = {
  id: string
  display_id: number
  created_at: string
  currency_code: string
  /** `logo` and `banner` are null when the shop hasn't uploaded them; screens show its initials. */
  seller: { id: string; name: string; handle: string | null; logo: string | null; banner: string | null }
  items: BuyerOrderItem[]
  /** Where the shop is with it: the same state its staff see. */
  fulfilment: BuyerFulfilmentView
  /** The delivery checkout quoted for it, counted from its shop's next opening (ADR 0004); null for a pickup order. */
  delivery: OrderDelivery | null
  /**
   * While the order is New and its shop closed: when the shop opens (ISO 8601) and prepares it
   * (ADR 0004), with the region's timezone to show it in. Null otherwise, and for a shop not set to reopen.
   */
  shop_opens: { at: string; time_zone: string } | null
  /** What the buyer paid for it, refunded or not. */
  paid_total: number
  /**
   * Its receipt, in shelf prices (VAT included): the items as placed, delivery, and the discount
   * off them. Items plus delivery, less the discount, is `paid_total`.
   */
  item_subtotal: number
  delivery_total: number
  discount_total: number
  /** The Paystack reference its checkout was paid with; null for an order nothing was paid for (a demo order). */
  payment_reference: string | null
  /** What has been refunded of it, and where that is; null while nothing has been. */
  refund: BuyerRefund | null
  /**
   * A refund the order owes and hasn't made (#16), and where it is: still `retrying`, or
   * `manual` once Oja's team sends it by hand; null while it owes nothing.
   */
  owed_refund: BuyerOwedRefund | null
  /**
   * The order's refund that needs the buyer's bank account (#13), whose screen in the app
   * takes one; null while none does.
   */
  refund_needing_account: string | null
  /** Where and when to collect a pickup order, and its code once ready (#12); null for a delivered order. */
  pickup: BuyerPickup | null
  /** Whether the buyer may review its shop and products (#7): once they have received it. */
  can_review: boolean
  /** The buyer's reviews of its shop and products, written on this order or an earlier one (one each), and where each is in moderation. */
  reviews: BuyerReview[]
}

/**
 * The order's delivery as its buyer sees it: the courier booked and when it said it delivers,
 * with the courier the buyer chose when another was booked (#19); before a booking (or once
 * Shipbubble cancelled one), the buyer's chosen rate on the order's Shipbubble method, as
 * checkout saved it.
 */
function buyerDelivery(
  o: { shipping_methods?: ({ data?: Record<string, unknown> | null } | null)[] | null },
  shipment: Shipment | null | undefined
): OrderDelivery | null {
  if (shipment && !shipment.cancelled_at) {
    return {
      courier_name: shipment.courier.courier_name,
      delivery_eta_time: shipment.delivery_eta_time,
      time_zone: SHIPBUBBLE_TIMEZONE,
      switched_from: switchedFrom(shipment)?.courier_name ?? null,
    }
  }
  const quote = (o.shipping_methods ?? []).map((m) => m?.data?.quote as ShipbubbleQuote | undefined).find((q) => q?.delivery_eta_time)
  return quote ? { courier_name: quote.courier_name, delivery_eta_time: quote.delivery_eta_time, time_zone: SHIPBUBBLE_TIMEZONE, switched_from: null } : null
}

/** When the order's closed shop opens, while the order waits for it as New. */
function shopOpens(state: string, hours: ShopHours | null, now: Date): BuyerOrder["shop_opens"] {
  if (state !== "new" || !hours) return null
  const status = shopStatus(hours, now)
  if (status.state === "open") return null
  const at = status.state === "closed" ? status.opens_at : status.until
  return at ? { at, time_zone: hours.time_zone } : null
}

/**
 * An order's fulfilment as its buyer sees it (#25): its state, the courier's tracking link once
 * a label is booked, and its timeline in the buyer's steps. Not who at the shop handed it over.
 */
export type BuyerFulfilmentView = Omit<FulfilmentView, "handover" | "collection" | "courier_approval" | "shipment"> & {
  shipment: Pick<NonNullable<FulfilmentView["shipment"]>, "waybill" | "courier_name" | "tracking_url" | "cancelled"> | null
}

function buyerFulfilment(record: FulfilmentRecord | undefined, order: PlacedOrder, hours: ShopHours | null): BuyerFulfilmentView {
  const {
    handover: _staffOnly,
    collection: _alsoStaffOnly,
    courier_approval: _forOjaToApprove,
    shipment,
    ...view
  } = fulfilmentView(record, order, hours, { audience: "buyer" })
  // What the courier costs the platform is the shop's and Oja's business, not the buyer's.
  return { ...view, shipment: shipment && { waybill: shipment.waybill, courier_name: shipment.courier_name, tracking_url: shipment.tracking_url, cancelled: shipment.cancelled } }
}

/**
 * A pickup order's collection details as its buyer sees them: the shop's collection point, open
 * the shop's hours, and the code to show at the counter, only while the order is Ready for pickup.
 */
export type BuyerPickup = CollectionPlace & { code: string | null }

/**
 * A shop removes its collection point only once none of its pickup orders is left to collect
 * (#12), so an order still to collect has one; a collected order then shows its timeline alone.
 */
function buyerPickup(record: FulfilmentRecord | undefined, place: CollectionPlace | undefined): BuyerPickup | null {
  if (record?.fulfilment.method !== "pickup" || !place) return null
  return { ...place, code: record.fulfilment.state === "ready_for_pickup" ? record.pickup_code : null }
}

/** An order's refunds as its buyer sees them: what comes back, and how far it has got. */
export type BuyerRefund = { amount: number; status: PaystackRefundStatus }

/** A refund the order owes its buyer, as the buyer sees it (#16). */
export type BuyerOwedRefund = Pick<OwedRefund, "amount" | "state">

type RefundRow = {
  amount: unknown
  status: string
  created_at: Date | string
  failure_reason?: string | null
  handed_over_at?: Date | string | null
}

/** The least settled first: the buyer is told about the refund that's furthest from done. */
const LEAST_SETTLED: PaystackRefundStatus[] = ["needs-attention", "failed", "pending", "processing", "processed"]

/**
 * Sums an order's refunds (`order_refund` rows) into what its buyer sees. A failed refund is
 * made again as a new refund, so one followed by a later refund no longer counts; until then
 * the refund is delayed. Failed attempts since then are tries at the same refund: only the
 * latest counts. A refund Paystack refused was never made, so it isn't one: what it was for is
 * still owed (`owed_refund`). Nor is one that needed the buyer's bank account and was handed to
 * Oja's team (#13): it is owed too, by hand, until Paystack settles it.
 */
export function buyerRefund(all: RefundRow[]): BuyerRefund | null {
  const rows = all.filter((r) => !refusedByPaystack(r) && !handedOver(r))
  const latestFailed = failedSinceLastMade(rows).at(-1)
  const counted = [...rows.filter(refundMade), ...(latestFailed ? [latestFailed] : [])]
  if (!counted.length) return null
  const statuses = new Set(counted.map((r) => r.status))
  return {
    amount: totalOf(counted.map((r) => r.amount)),
    status: LEAST_SETTLED.find((s) => statuses.has(s)) ?? "pending",
  }
}

const buyerOwedRefund = (owed: OwedRefund | undefined): BuyerOwedRefund | null =>
  owed ? { amount: owed.amount, state: owed.state } : null

/** A checkout, as its buyer sees it: the shops' orders it was split into. */
export type BuyerOrderGroup = {
  id: string
  display_id: number
  created_at: string
  orders: BuyerOrder[]
}

const ORDER_FIELDS = [
  "id",
  "display_id",
  "created_at",
  "currency_code",
  "seller.id",
  "seller.name",
  "seller.handle",
  "seller.logo",
  "seller.banner",
  "items.id",
  "items.product_id",
  "items.product_title",
  "items.variant_id",
  "items.variant_title",
  "items.thumbnail",
  "items.quantity",
  "items.detail.quantity",
  "items.unit_price",
  "items.total",
  "total",
  "credit_line_total",
  "original_shipping_total",
  "discount_total",
  "transactions.amount",
  "transactions.reference",
  ...METHOD_FIELDS,
  ...HOLD_LINE_FIELDS,
]

type GroupRow = { id: string; display_id: number; created_at: Date | string; orders?: ({ id: string } | null)[] | null }

/** The buyer's order groups, newest first. */
export async function listBuyerOrderGroups(
  scope: Scope,
  customerId: string,
  page: { limit: number; offset: number }
): Promise<{ order_groups: BuyerOrderGroup[]; count: number }> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data, metadata } = await query.graph({
    entity: "order_group",
    fields: ["id", "display_id", "created_at", "orders.id"],
    filters: { customer_id: customerId },
    pagination: { skip: page.offset, take: page.limit, order: { created_at: "DESC" } },
  })
  return { order_groups: await withOrders(scope, customerId, data as unknown as GroupRow[]), count: metadata?.count ?? 0 }
}

/** One of the buyer's order groups; another buyer's is not found. */
export async function retrieveBuyerOrderGroup(scope: Scope, customerId: string, id: string): Promise<BuyerOrderGroup> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order_group",
    fields: ["id", "display_id", "created_at", "orders.id"],
    filters: { id, customer_id: customerId },
  })
  const [group] = await withOrders(scope, customerId, data as unknown as GroupRow[])
  if (!group) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order group with id ${id} was not found`)
  return group
}

async function withOrders(scope: Scope, customerId: string, groups: GroupRow[]): Promise<BuyerOrderGroup[]> {
  const ids = groups.flatMap((g) => (g.orders ?? []).flatMap((o) => (o ? [o.id] : [])))
  const orders = await buyerOrders(scope, customerId, ids)
  return groups.map((g) => ({
    id: g.id,
    display_id: g.display_id,
    created_at: new Date(g.created_at).toISOString(),
    orders: (g.orders ?? []).flatMap((o) => {
      const order = o && orders.get(o.id)
      return order ? [order] : []
    }),
  }))
}

async function buyerOrders(scope: Scope, customerId: string, ids: string[]): Promise<Map<string, BuyerOrder>> {
  if (!ids.length) return new Map()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const [{ data }, fulfilments, refunds, owed, reviews, payments] = await Promise.all([
    query.graph({ entity: "order", fields: ORDER_FIELDS, filters: { id: ids } }),
    fulfilmentsOf(scope, ids),
    fulfilmentService(scope).listOrderRefunds({ order_id: ids }),
    owedRefundsOf(scope, ids),
    buyerReviews(scope, customerId),
    paymentsOfOrders(scope, ids),
  ])
  const sellerIds = (data as any[]).flatMap((o) => (o.seller?.id ? [o.seller.id] : []))
  const [hours, places, lines] = await Promise.all([
    shopHoursOf(scope, sellerIds),
    collectionPlacesOf(scope, sellerIds),
    holdLinesOf(scope, data as any[]),
  ])
  const refundsOf = (orderId: string) => refunds.filter((r) => r.order_id === orderId)
  const now = new Date()
  return new Map(
    (data as any[]).map((o) => {
      const record = fulfilments.get(o.id)
      const shopHours = hours.get(o.seller?.id) ?? null
      const fulfilment = buyerFulfilment(record, { placed_at: o.created_at, method: methodOfOrder(o), lines: lines.get(o.id) }, shopHours)
      return [
        o.id,
        {
          ...buyerOrder(o, record?.removed ?? {}),
          payment_reference: paymentReference(payments.get(o.id) ?? []),
          fulfilment,
          delivery: fulfilment.method === "delivery" ? buyerDelivery(o, record?.shipment) : null,
          shop_opens: shopOpens(fulfilment.state, shopHours, now),
          refund: buyerRefund(refundsOf(o.id)),
          owed_refund: buyerOwedRefund(owed.get(o.id)),
          refund_needing_account: refundsOf(o.id).find(needsAccount)?.id ?? null,
          pickup: buyerPickup(record, places.get(o.seller?.id)),
          // An order without a fulfilment row yet is New.
          can_review: canReview(record?.state ?? "new"),
          reviews: reviewsOf(o, reviews),
        },
      ]
    })
  )
}

/** The buyer's reviews of the order's shop and of the products on it, whichever order each was written on. */
function reviewsOf(o: any, reviews: Map<string, BuyerReview>): BuyerReview[] {
  const productIds = new Set<string>((o.items ?? []).flatMap((i: any) => (i.product_id ? [i.product_id] : [])))
  const subjects = [
    ...(o.seller?.id ? [{ reference: "seller" as const, reference_id: o.seller.id as string }] : []),
    ...[...productIds].map((reference_id) => ({ reference: "product" as const, reference_id })),
  ]
  return subjects.flatMap((subject) => reviews.get(subjectKey(subject)) ?? [])
}

/**
 * What the buyer paid for the order: what was captured for it. Neither a refund (whose credit
 * line takes it off `total`, #20) nor items removed as unavailable (an order edit lowers
 * `total`, #22) change it. An order nothing was captured for (a demo order) is its total.
 */
function paidTotal(o: any): number {
  const captures = ((o.transactions ?? []) as ({ amount: unknown; reference: string | null } | null)[]).filter(
    (t) => t?.reference === "capture"
  )
  if (!captures.length) return Number(o.total) + Number(o.credit_line_total ?? 0)
  return captures.reduce((sum, t) => sum + Number(t!.amount), 0)
}

/** The Paystack reference of the payment that paid for the order: the captured one's, else any. */
function paymentReference(payments: { data?: Record<string, unknown> | null; captures?: unknown[] | null }[]): string | null {
  const referenceOf = (p: (typeof payments)[number]) => (typeof p.data?.reference === "string" ? p.data.reference : null)
  const captured = payments.filter((p) => p.captures?.length)
  return [...captured, ...payments].map(referenceOf).find((r) => r) ?? null
}

function buyerOrder(
  o: any,
  removed: Picks
): Omit<
  BuyerOrder,
  "fulfilment" | "delivery" | "shop_opens" | "refund" | "owed_refund" | "refund_needing_account" | "pickup" | "can_review" | "reviews" | "payment_reference"
> {
  const items: BuyerOrderItem[] = (o.items ?? []).map((i: any) => ({
    id: i.id,
    product_id: i.product_id ?? null,
    product_title: i.product_title ?? null,
    variant_id: i.variant_id ?? null,
    variant_title: i.variant_title ?? null,
    thumbnail: i.thumbnail ?? null,
    quantity: Number(i.detail?.quantity ?? i.quantity),
    unavailable_quantity: removed[i.id] ?? 0,
    unit_price: Number(i.unit_price),
    total: Number(i.total),
  }))
  return {
    id: o.id,
    display_id: o.display_id,
    created_at: new Date(o.created_at).toISOString(),
    currency_code: o.currency_code,
    paid_total: paidTotal(o),
    // As placed: items the shop removed as unavailable (#22) are refunded, not taken off the receipt.
    item_subtotal: items.reduce((sum, i) => sum + i.unit_price * (i.quantity + i.unavailable_quantity), 0),
    delivery_total: Number(o.original_shipping_total ?? 0),
    discount_total: Number(o.discount_total ?? 0),
    seller: {
      id: o.seller?.id,
      name: o.seller?.name,
      handle: o.seller?.handle ?? null,
      logo: o.seller?.logo ?? null,
      banner: o.seller?.banner ?? null,
    },
    items,
  }
}
