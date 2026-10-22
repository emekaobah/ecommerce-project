import { canReview, reviewAction, reviewerName, type FulfilmentState, type ReviewStatus, type ReviewSubject } from "@oja/domain"
import type { Knex } from "@medusajs/framework/mikro-orm/knex"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { ReviewDTO } from "@mercurjs/types"
import { fulfilmentService, fulfilmentsOf } from "./order-fulfilment"

// Reviews and ratings (#7) on Mercur's review module: one `review` per target (a shop, or a
// catalogue product), linked to the order that earned it and the buyer who wrote it, and
// moderated by an operator (pending → published or rejected) before other buyers see it.

type Scope = Pick<MedusaContainer, "resolve">

type ReviewableOrderRow = {
  id: string
  seller?: { id: string } | null
  items?: ({ product_id: string | null; quantity: unknown; detail?: { quantity: unknown } | null } | null)[] | null
}

/**
 * Refuses a review the buyer may not write: of another buyer's order (not found), of a shop's
 * order before it reached its terminal success state (`canReview`), of a target the order didn't
 * bring them (a shop other than the order's, or a product they didn't receive on it), or of a
 * target they already reviewed, on any order: a buyer has one review of each shop and product,
 * and edits it (Mercur refuses a second review on one order the same way).
 */
export async function assertReviewable(
  scope: Scope,
  { customer_id, order_id, reference, reference_id }: ReviewSubject & { customer_id: string; order_id: string }
): Promise<void> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "seller.id", "items.product_id", "items.quantity", "items.detail.quantity"],
    filters: { id: order_id, customer_id },
  })
  const [order] = data as unknown as ReviewableOrderRow[]
  if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order with id ${order_id} was not found`)

  const fulfilment = (await fulfilmentsOf(scope, [order_id])).get(order_id)
  if (!fulfilment || !canReview(fulfilment.state)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "You can review an order once you have received it")
  }

  const received = (order.items ?? []).some(
    (item) => item?.product_id === reference_id && Number(item.detail?.quantity ?? item.quantity) > 0
  )
  const ofOrder = reference === "seller" ? order.seller?.id === reference_id : received
  if (!ofOrder) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `This order has no ${reference} ${reference_id} to review`)
  }

  const subjects = reference === "seller" ? { seller_ids: [reference_id], product_ids: [] } : { seller_ids: [], product_ids: [reference_id] }
  if ((await buyerReviews(scope, customer_id, subjects)).has(subjectKey({ reference, reference_id }))) {
    const what = reference === "seller" ? "this shop" : "this product"
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `You've already reviewed ${what}. Edit your review instead.`)
  }
}

/**
 * A review as its author sees it on their order: what it's of and where it is in moderation.
 * The shop's reply shows only once the review is published, as it does to other buyers.
 */
export type BuyerReview = ReviewSubject & {
  id: string
  rating: number
  customer_note: string | null
  seller_note: string | null
  status: ReviewStatus
}

/**
 * A review as its author is shown it: the shop's reply hidden until the review is published,
 * as other buyers see it. A review read without its status shows no reply.
 */
export function asAuthorSees<R extends { seller_note?: string | null; status?: ReviewStatus }>(review: R): R {
  return review.status === "published" ? review : { ...review, seller_note: null }
}

type GraphPage = { skip?: number; take?: number; order?: Record<string, unknown> }

/**
 * Reviews as their author is shown them (`asAuthorSees`), for the buyer's own review routes.
 * Status is always read, since it decides whether the reply shows.
 */
export async function authorReviews(
  scope: Scope,
  { fields, filters, pagination }: { fields: string[]; filters: Record<string, unknown>; pagination?: GraphPage }
) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data, metadata } = await query.graph({
    entity: "review",
    fields: [...new Set([...fields, "status"])],
    filters,
    pagination,
  })
  return { reviews: (data as unknown as ReviewDTO[]).map(asAuthorSees), metadata }
}

/** A subject's key in a map of the buyer's reviews. */
export const subjectKey = ({ reference, reference_id }: ReviewSubject) => `${reference}:${reference_id}`

/**
 * A review has no author or target column, only Mercur's links of it to its author and to what
 * it is of: link tables, named by Medusa after each side's module and entity, each with the
 * linked side's id column. Mercur's review service joins the product and seller ones by these
 * names for its own (status-blind) ratings.
 */
const REVIEW_LINKS = {
  customer: { table: "customer_customer_review_review", column: "customer_id" },
  product: { table: "product_product_review_review", column: "product_id" },
  seller: { table: "seller_seller_review_review", column: "seller_id" },
} as const

/** Which shops and products to read the buyer's reviews of. */
export type ReviewSubjects = { seller_ids: readonly string[]; product_ids: readonly string[] }

type BuyerReviewRow = Omit<BuyerReview, "rating"> & { rating: unknown }

/**
 * The buyer's reviews, by what each is of (`subjectKey`): one per shop and per product, whichever
 * order it was written on (#7). Given `of`, only their reviews of those shops and products, so
 * a page of orders reads its own reviews alone (#54).
 */
export async function buyerReviews(scope: Scope, customerId: string, of?: ReviewSubjects): Promise<Map<string, BuyerReview>> {
  if (of && !of.seller_ids.length && !of.product_ids.length) return new Map()
  const knex = scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION)
  const query = knex(`${REVIEW_LINKS.customer.table} as cr`)
    .join("review as r", "r.id", "cr.review_id")
    .leftJoin(`${REVIEW_LINKS.product.table} as pr`, function () {
      this.on("pr.review_id", "r.id").andOnNull("pr.deleted_at")
    })
    .leftJoin(`${REVIEW_LINKS.seller.table} as sr`, function () {
      this.on("sr.review_id", "r.id").andOnNull("sr.deleted_at")
    })
    .where("cr.customer_id", customerId)
    .whereNull("cr.deleted_at")
    // A deleted review keeps its link.
    .whereNull("r.deleted_at")
    .select(
      "r.id",
      "r.reference",
      "r.rating",
      "r.customer_note",
      "r.seller_note",
      "r.status",
      knex.raw("CASE WHEN r.reference = 'product' THEN pr.product_id ELSE sr.seller_id END AS reference_id")
    )
  if (of) {
    query.where(function () {
      this.where(function () {
        this.where("r.reference", "product").whereIn("pr.product_id", [...of.product_ids])
      }).orWhere(function () {
        this.where("r.reference", "seller").whereIn("sr.seller_id", [...of.seller_ids])
      })
    })
  }
  const rows = (await query) as unknown as BuyerReviewRow[]
  const bySubject = new Map<string, BuyerReview>()
  for (const row of rows) {
    if (!row.reference_id) continue
    bySubject.set(subjectKey(row), asAuthorSees({ ...row, rating: Number(row.rating) }))
  }
  return bySubject
}

type ReceivedOrderRow = {
  seller?: { id: string; name: string } | null
  items?: ({ product_id: string | null; product_title: string | null; quantity: unknown; detail?: { quantity: unknown } | null } | null)[] | null
}

/**
 * How many reviews the buyer wrote, and how many of their received orders still have a shop or
 * product to review: those whose review action is to write, as each order shows it (#73).
 */
export async function buyerReviewCounts(
  scope: Scope,
  customerId: string
): Promise<{ reviews_written: number; orders_to_review: number }> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const [fulfilments, reviews] = await Promise.all([
    fulfilmentService(scope).listOrderFulfilments({ customer_id: customerId }, { select: ["order_id", "state"] }),
    buyerReviews(scope, customerId),
  ])
  const receivedIds = fulfilments.filter((f) => canReview(f.state as FulfilmentState)).map((f) => f.order_id)
  if (!receivedIds.length) return { reviews_written: reviews.size, orders_to_review: 0 }

  const { data: received } = await query.graph({
    entity: "order",
    fields: ["seller.id", "seller.name", "items.product_id", "items.product_title", "items.quantity", "items.detail.quantity"],
    filters: { id: receivedIds },
  })
  const ownReviews = [...reviews.values()]
  const toReview = (received as unknown as ReceivedOrderRow[]).filter(
    ({ seller, items }) =>
      seller &&
      reviewAction({
        can_review: true,
        seller,
        items: (items ?? []).flatMap((i) =>
          i ? [{ product_id: i.product_id, product_title: i.product_title, quantity: Number(i.detail?.quantity ?? i.quantity) }] : []
        ),
        reviews: ownReviews,
      }) === "write"
  )
  return { reviews_written: reviews.size, orders_to_review: toReview.length }
}

/** A published review as any buyer sees it: the reviewer by first name and initial only. */
export type PublicReview = {
  id: string
  rating: number
  customer_note: string | null
  /** The shop's reply, if it gave one. */
  seller_note: string | null
  author: string
  created_at: string
}

/** A page of a shop's or product's published reviews, newest first, and the average and count of them all. */
export type PublishedReviews = { reviews: PublicReview[]; average_rating: number | null; count: number }

type ReviewRow = {
  id: string
  rating: number
  customer_note: string | null
  seller_note: string | null
  created_at: Date | string
  customer?: { first_name: string | null; last_name: string | null } | null
}

/** The target's published reviews, as a query to aggregate or page through. */
function publishedOf(scope: Scope, { reference, reference_id }: ReviewSubject) {
  const knex = scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION)
  const { table, column } = REVIEW_LINKS[reference]
  return knex("review")
    .join(table, `${table}.review_id`, "review.id")
    .where(`${table}.${column}`, reference_id)
    .where("review.status", "published")
    .whereNull("review.deleted_at")
    .whereNull(`${table}.deleted_at`)
}

/**
 * A shop's or a product's published reviews, newest first: what other buyers see (#7). Pending
 * and rejected reviews never count, toward the list or the rating, which the database averages
 * and counts.
 */
export async function publishedReviews(
  scope: Scope,
  target: ReviewSubject,
  page: { limit: number; offset: number }
): Promise<PublishedReviews> {
  const [[rating], pageRows] = await Promise.all([
    publishedOf(scope, target).avg({ average: "review.rating" }).count({ count: "review.id" }),
    publishedOf(scope, target)
      .select("review.id")
      .orderBy([{ column: "review.created_at", order: "desc" }, { column: "review.id", order: "desc" }])
      .limit(page.limit)
      .offset(page.offset),
  ])
  const count = Number(rating?.count ?? 0)
  const average_rating = count ? Number(rating!.average) : null
  const ids = (pageRows as { id: string }[]).map((r) => r.id)
  if (!ids.length) return { reviews: [], average_rating, count }

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "review",
    fields: ["id", "rating", "customer_note", "seller_note", "created_at", "customer.first_name", "customer.last_name"],
    filters: { id: ids },
  })
  const byId = new Map((data as unknown as ReviewRow[]).map((r) => [r.id, r]))
  return {
    // In the page's order, newest first.
    reviews: ids.flatMap((id) => {
      const r = byId.get(id)
      return r
        ? [
            {
              id: r.id,
              rating: Number(r.rating),
              customer_note: r.customer_note,
              seller_note: r.seller_note,
              author: reviewerName(r.customer),
              created_at: new Date(r.created_at).toISOString(),
            },
          ]
        : []
    }),
    average_rating,
    count,
  }
}
