import { canReview, reviewerName } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import ProductReviewLink from "@mercurjs/core/links/product-review"
import SellerReviewLink from "@mercurjs/core/links/seller-review"
import { fulfilmentsOf } from "./order-fulfilment"

// Reviews and ratings (#7) on Mercur's review module: one `review` per target (a shop, or a
// catalogue product), linked to the order that earned it and the buyer who wrote it, and
// moderated by an operator (pending → published or rejected) before other buyers see it.

type Scope = Pick<MedusaContainer, "resolve">

export type ReviewTarget = { reference: "product" | "seller"; reference_id: string }

type ReviewableOrderRow = {
  id: string
  seller?: { id: string } | null
  items?: ({ product_id: string | null; quantity: unknown; detail?: { quantity: unknown } | null } | null)[] | null
}

/**
 * Refuses a review the buyer may not write: of another buyer's order (not found), of a shop's
 * order before it reached its terminal success state (`canReview`), or of a target the order
 * didn't bring them: a shop other than the order's, or a product they didn't receive on it.
 * Mercur's create workflow then checks the target isn't already reviewed on the order.
 */
export async function assertReviewable(
  scope: Scope,
  { customer_id, order_id, reference, reference_id }: ReviewTarget & { customer_id: string; order_id: string }
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

const LINKS = {
  product: { entryPoint: ProductReviewLink.entryPoint, column: "product_id" },
  seller: { entryPoint: SellerReviewLink.entryPoint, column: "seller_id" },
} as const

/** Ids of every review of the target, whatever its status; a review has no target column, only a link. */
async function reviewIdsOf(scope: Scope, { reference, reference_id }: ReviewTarget): Promise<string[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { entryPoint, column } = LINKS[reference]
  const { data } = await query.graph({ entity: entryPoint, fields: ["review_id"], filters: { [column]: reference_id } })
  return (data as unknown as { review_id: string }[]).map((link) => link.review_id)
}

/**
 * A shop's or a product's published reviews, newest first: what other buyers see (#7). Pending
 * and rejected reviews never count, toward the list or the rating.
 */
export async function publishedReviews(
  scope: Scope,
  target: ReviewTarget,
  page: { limit: number; offset: number }
): Promise<PublishedReviews> {
  const ids = await reviewIdsOf(scope, target)
  if (!ids.length) return { reviews: [], average_rating: null, count: 0 }

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const filters = { id: ids, status: "published" as const }
  const [{ data: rows }, { data: ratings }] = await Promise.all([
    query.graph({
      entity: "review",
      fields: ["id", "rating", "customer_note", "seller_note", "created_at", "customer.first_name", "customer.last_name"],
      filters,
      pagination: { skip: page.offset, take: page.limit, order: { created_at: "DESC" } },
    }),
    query.graph({ entity: "review", fields: ["rating"], filters }),
  ])
  const all = (ratings as unknown as { rating: number }[]).map((r) => Number(r.rating))
  return {
    reviews: (rows as unknown as ReviewRow[]).map((r) => ({
      id: r.id,
      rating: Number(r.rating),
      customer_note: r.customer_note,
      seller_note: r.seller_note,
      author: reviewerName(r.customer),
      created_at: new Date(r.created_at).toISOString(),
    })),
    average_rating: all.length ? all.reduce((sum, rating) => sum + rating, 0) / all.length : null,
    count: all.length,
  }
}
