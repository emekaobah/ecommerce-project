import { canReview, type ShopHours } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { PaystackRefundStatus } from "../modules/paystack/client"
import { collectionPlacesOf, type CollectionPlace } from "./collection-point"
import {
  fulfilmentService,
  fulfilmentsOf,
  fulfilmentView,
  METHOD_FIELDS,
  methodOfOrder,
  type FulfilmentRecord,
  type FulfilmentView,
  type Picks,
  type PlacedOrder,
} from "./order-fulfilment"
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
  seller: { id: string; name: string; handle: string | null; logo: string | null }
  items: BuyerOrderItem[]
  /** Where the shop is with it: the same state its staff see. */
  fulfilment: BuyerFulfilmentView
  /** What the buyer paid for it, refunded or not. */
  paid_total: number
  /** What has been refunded of it, and where that is; null while nothing has been. */
  refund: BuyerRefund | null
  /** Where and when to collect a pickup order, and its code once ready (#12); null for a delivered order. */
  pickup: BuyerPickup | null
  /** Whether the buyer may review its shop and products (#7): once they have received it. */
  can_review: boolean
  /** The buyer's reviews of its shop and products, written on this order or an earlier one (one each), and where each is in moderation. */
  reviews: BuyerReview[]
}

/**
 * An order's fulfilment as its buyer sees it (#25): its state, the courier's tracking link once
 * a label is booked, and its timeline in the buyer's steps. Not who at the shop handed it over.
 */
export type BuyerFulfilmentView = Omit<FulfilmentView, "handover" | "collection">

function buyerFulfilment(record: FulfilmentRecord | undefined, order: PlacedOrder, hours: ShopHours | null): BuyerFulfilmentView {
  const { handover: _staffOnly, collection: _alsoStaffOnly, ...view } = fulfilmentView(record, order, hours, { audience: "buyer" })
  return view
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

type RefundRow = { amount: unknown; status: string; created_at: Date | string }

/** The least settled first: the buyer is told about the refund that's furthest from done. */
const LEAST_SETTLED: PaystackRefundStatus[] = ["needs-attention", "failed", "pending", "processing", "processed"]

/**
 * Sums an order's refunds (`order_refund` rows) into what its buyer sees. A failed refund is
 * made again as a new refund, so one followed by a later refund no longer counts; until then
 * the refund is delayed. Failed attempts since then are tries at the same refund: only the
 * latest counts.
 */
export function buyerRefund(rows: RefundRow[]): BuyerRefund | null {
  const time = (r: RefundRow) => new Date(r.created_at).getTime()
  const lastMade = Math.max(-Infinity, ...rows.filter((r) => r.status !== "failed").map(time))
  const stillFailed = rows.filter((r) => r.status === "failed" && time(r) > lastMade)
  const latestFailed = stillFailed.reduce<RefundRow | undefined>((a, r) => (!a || time(r) > time(a) ? r : a), undefined)
  const counted = [...rows.filter((r) => r.status !== "failed"), ...(latestFailed ? [latestFailed] : [])]
  if (!counted.length) return null
  const statuses = new Set(counted.map((r) => r.status))
  return {
    amount: counted.reduce((sum, r) => sum + Number(r.amount), 0),
    status: LEAST_SETTLED.find((s) => statuses.has(s)) ?? "pending",
  }
}

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
  "items.id",
  "items.product_id",
  "items.product_title",
  "items.variant_title",
  "items.thumbnail",
  "items.quantity",
  "items.detail.quantity",
  "items.unit_price",
  "items.total",
  "total",
  "credit_line_total",
  "transactions.amount",
  "transactions.reference",
  ...METHOD_FIELDS,
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
  const [{ data }, fulfilments, refunds, reviews] = await Promise.all([
    query.graph({ entity: "order", fields: ORDER_FIELDS, filters: { id: ids } }),
    fulfilmentsOf(scope, ids),
    fulfilmentService(scope).listOrderRefunds({ order_id: ids }),
    buyerReviews(scope, customerId),
  ])
  const sellerIds = (data as any[]).flatMap((o) => (o.seller?.id ? [o.seller.id] : []))
  const [hours, places] = await Promise.all([shopHoursOf(scope, sellerIds), collectionPlacesOf(scope, sellerIds)])
  const refundsOf = (orderId: string) => refunds.filter((r) => r.order_id === orderId)
  return new Map(
    (data as any[]).map((o) => {
      const record = fulfilments.get(o.id)
      const shopHours = hours.get(o.seller?.id) ?? null
      return [
        o.id,
        {
          ...buyerOrder(o, record?.removed ?? {}),
          fulfilment: buyerFulfilment(record, { placed_at: o.created_at, method: methodOfOrder(o) }, shopHours),
          refund: buyerRefund(refundsOf(o.id)),
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

function buyerOrder(o: any, removed: Picks): Omit<BuyerOrder, "fulfilment" | "refund" | "pickup" | "can_review" | "reviews"> {
  return {
    id: o.id,
    display_id: o.display_id,
    created_at: new Date(o.created_at).toISOString(),
    currency_code: o.currency_code,
    paid_total: paidTotal(o),
    seller: {
      id: o.seller?.id,
      name: o.seller?.name,
      handle: o.seller?.handle ?? null,
      logo: o.seller?.logo ?? null,
    },
    items: (o.items ?? []).map((i: any) => ({
      id: i.id,
      product_id: i.product_id ?? null,
      product_title: i.product_title ?? null,
      variant_title: i.variant_title ?? null,
      thumbnail: i.thumbnail ?? null,
      quantity: Number(i.detail?.quantity ?? i.quantity),
      unavailable_quantity: removed[i.id] ?? 0,
      unit_price: Number(i.unit_price),
      total: Number(i.total),
    })),
  }
}
