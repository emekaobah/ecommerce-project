import type { FulfilmentState } from "./fulfilment"
import type { StatusView } from "./order-history"

/**
 * Reviews and ratings (#7). Buyers rate the shops they bought from and the products they
 * received; every review is moderated before other buyers see it.
 */

/**
 * The states a shop's order ends in once the buyer has it: the fulfilment's terminal success.
 * A delivery ends Delivered; a pickup path (#12) adds its own end here.
 */
const RECEIVED: ReadonlySet<FulfilmentState> = new Set<FulfilmentState>(["delivered"])

/**
 * Whether the buyer may review a shop's order (the shop, and the products on it): only once the
 * order reached its terminal success state, so every review is of goods the buyer received.
 */
export function canReview(state: FulfilmentState): boolean {
  return RECEIVED.has(state)
}

type ReviewerNames = { first_name?: string | null; last_name?: string | null }

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
