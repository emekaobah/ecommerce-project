import type { CancelReason, CancelRequest, Cancellation } from "./fulfilment"

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

/** Who cancelled an order, as staff and its buyer read it: Oja's team, or the shop (by name, when given). */
export function cancelledBy(by: Cancellation["by"], shop?: string): string {
  return by === "operator" ? "Oja's team" : (shop ?? "the shop")
}

/** What staff have filled in on the cancel form so far: no reason until they pick one, and the note as typed. */
export type CancelForm = { reason: CancelReason | null; note: string }

/**
 * The cancel request staff's form makes, or null while it is incomplete: a reason, and for
 * `other` a note saying what it is. A note is trimmed, and left out when blank.
 */
export function cancelRequest({ reason, note }: CancelForm): CancelRequest | null {
  const trimmed = note.trim()
  if (!reason || (reason === "other" && !trimmed)) return null
  return trimmed ? { reason, note: trimmed } : { reason }
}

/** The reasons as staff choose one on the cancel form: Other asks them to write why. */
export const CANCEL_REASON_CHOICES: Record<CancelReason, string> = {
  ...CANCEL_REASON_LABELS,
  other: "Other (write why)",
}

/** "Chidi O. is refunded the ₦19,700 left on the order.": what cancelling refunds, said before the button. */
export function cancelRefundNote(buyer: string | null, amount: string): string {
  return `${buyer ?? "The buyer"} is refunded the ${amount} left on the order.`
}
