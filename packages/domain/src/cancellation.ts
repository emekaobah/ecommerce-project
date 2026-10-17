import type { CancelReason, Cancellation } from "./fulfilment"

/**
 * Why an accepted order was cancelled (#17), as staff pick it in the vendor app and the admin,
 * and as its buyer is told.
 */
export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  items_unavailable: "Items unavailable",
  cannot_fulfil: "Shop can't fulfil this order",
  buyer_asked: "Buyer asked to cancel",
  other: "Other",
}

/** A cancellation's reason as its buyer reads it: the label, or for `other` the note staff wrote. */
export function cancelReasonText({ reason, note }: Pick<Cancellation, "reason" | "note">): string {
  if (reason === "other") return note ?? CANCEL_REASON_LABELS.other
  return note ? `${CANCEL_REASON_LABELS[reason]}: ${note}` : CANCEL_REASON_LABELS[reason]
}
