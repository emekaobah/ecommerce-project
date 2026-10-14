import type { FulfilmentState } from "./fulfilment"
import type { StatusView } from "./order-history"

/**
 * Reviews and ratings (#7). Buyers rate the shops they bought from and the products they
 * received; every review is moderated before other buyers see it.
 */

/**
 * The states a shop's order ends in once the buyer has it: the fulfilment's terminal success.
 * A delivery ends Delivered; an in-store pickup (#12) ends Collected.
 */
const RECEIVED: ReadonlySet<FulfilmentState> = new Set<FulfilmentState>(["delivered", "collected"])

/**
 * Whether the buyer may review a shop's order (the shop, and the products on it): only once the
 * order reached its terminal success state, so every review is of goods the buyer received.
 */
export function canReview(state: FulfilmentState): boolean {
  return RECEIVED.has(state)
}

/** What a review is of: a shop, or a catalogue product (whichever shop sold it). */
export type ReviewKind = "seller" | "product"

/** What one review is of: its kind and that shop's or product's id. */
export type ReviewSubject = { reference: ReviewKind; reference_id: string }

/** Something on a received order the buyer can rate, named as the order names it. */
export type ReviewTarget = ReviewSubject & { title: string }

/** The buyer's own review of a shop or product, as their order carries it. */
export type OwnReview = ReviewSubject & { id: string; rating: number; customer_note: string | null }

type ReviewableOrder = {
  seller: { id: string; name: string }
  items: readonly { product_id: string | null; product_title: string | null; quantity: number }[]
  /** The buyer's reviews of the order's shop and products, whichever order each was written on. */
  reviews: readonly OwnReview[]
}

/** The shop and each product the buyer received on the order (once, however many lines it's on). */
function receivedTargets(order: ReviewableOrder): ReviewTarget[] {
  const products = new Map<string, string>()
  for (const item of order.items) {
    if (item.product_id && item.quantity > 0 && !products.has(item.product_id)) {
      products.set(item.product_id, item.product_title ?? "Product")
    }
  }
  return [
    { reference: "seller", reference_id: order.seller.id, title: order.seller.name },
    ...[...products].map(([reference_id, title]) => ({ reference: "product" as const, reference_id, title })),
  ]
}

const sameSubject = (a: ReviewSubject, b: ReviewSubject) => a.reference === b.reference && a.reference_id === b.reference_id

/** A line of the review form: what to rate, and the buyer's review of it to edit, if they wrote one. */
export type ReviewFormEntry = ReviewTarget & { review: OwnReview | null }

/**
 * The review form for a received order: the shop, then each product the buyer got (not one
 * removed as unavailable), each with the buyer's review of it if they already wrote one. A
 * buyer has one review of each shop and product, whichever order they wrote it on, and edits it
 * there rather than writing another: Oja sells everyday goods bought again and again.
 */
export function reviewForm(order: ReviewableOrder): ReviewFormEntry[] {
  return receivedTargets(order).map((t) => ({ ...t, review: order.reviews.find((r) => sameSubject(r, t)) ?? null }))
}

/** What the order offers: reviewing it, or editing the reviews once all are written; nothing until it's received. */
export function reviewAction(order: ReviewableOrder & { can_review: boolean }): "write" | "edit" | null {
  if (!order.can_review) return null
  return reviewForm(order).some((entry) => !entry.review) ? "write" : "edit"
}

/** What a review on the order is of, as the order names it. */
export function reviewTitle(order: ReviewableOrder, review: ReviewSubject): string {
  return receivedTargets(order).find((t) => sameSubject(t, review))?.title ?? "Product"
}

type ReviewerNames ={ first_name?: string | null; last_name?: string | null }

/** How a reviewer is shown to other buyers: first name and last initial ("Ada O."), never the full name. */
export function reviewerName(customer: ReviewerNames | null | undefined): string {
  const first = customer?.first_name?.trim()
  if (!first) return "A buyer"
  const initial = customer?.last_name?.trim().charAt(0)
  return initial ? `${first} ${initial.toUpperCase()}.` : first
}

/** A product's or shop's published rating: the average of its published reviews and how many there are. */
export type Rating = { average: number | null; count: number }

/** A rating as one line: "4.3 · 12 reviews", or "No reviews yet". */
export function ratingSummary({ average, count }: Rating): string {
  if (average == null || !count) return "No reviews yet"
  return `${average.toFixed(1)} · ${count} ${count === 1 ? "review" : "reviews"}`
}

/** Mercur's review moderation states: every review starts pending until an operator moderates it. */
export type ReviewStatus = "pending" | "published" | "rejected"

const STATUSES: Record<ReviewStatus, StatusView> = {
  pending: {
    label: "Waiting for moderation",
    tone: "warning",
    note: "We check every review before it's published. Other buyers will see it once it is.",
  },
  published: { label: "Published", tone: "success", note: null },
  rejected: { label: "Not published", tone: "danger", note: "It didn't meet our review guidelines." },
}

/** Where the buyer's own review is in moderation, as its author reads it. */
export function reviewStatus(status: ReviewStatus): StatusView {
  return STATUSES[status]
}
