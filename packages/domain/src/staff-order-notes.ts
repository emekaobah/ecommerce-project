// What the vendor app's order page says of an order that ended before it was sent (#17, #18).

import { cancelledBy, cancelReasonText } from "./cancellation"
import type { Cancellation } from "./fulfilment"
import { asSentence } from "./sentence"

/** "Rejected: Out of stock. The buyer's payment…", or "Not accepted in time." when its deadline passed. */
export function rejectedNote({ rejected_by, reject_reason }: { rejected_by: "seller" | "accept_deadline" | null; reject_reason: string | null }): string {
  const why = rejected_by === "accept_deadline" ? "Not accepted in time." : `Rejected: ${asSentence(reject_reason ?? "")}`
  return `${why} The buyer's payment for this order is being refunded.`
}

/** "Cancelled by the shop: Items unavailable. The buyer is refunded all they paid for it." */
export function cancelledNote(cancellation: Pick<Cancellation, "by" | "reason" | "note">): string {
  return `Cancelled by ${cancelledBy(cancellation.by)}: ${asSentence(cancelReasonText(cancellation))} The buyer is refunded all they paid for it.`
}
