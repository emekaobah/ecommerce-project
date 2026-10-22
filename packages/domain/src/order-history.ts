import { cancelledBy, cancelReasonText } from "./cancellation"
import type { Cancellation, FulfilmentState } from "./fulfilment"
import { formatMoney } from "./money"
import type { StatusView } from "./status"

/**
 * How the buyer app shows its order history (#17): each checkout is an order group, split into
 * one order per shop, each with its own state, and its refund if the shop rejected it.
 */

export type OrderFulfilmentView = {
  state: FulfilmentState
  rejected_by: "seller" | "accept_deadline" | null
  reject_reason: string | null
  /** Who cancelled an accepted order and why (#17); null unless it is cancelled. */
  cancellation: Pick<Cancellation, "by" | "reason" | "note"> | null
}

/** What the buyer is told of each state; staff's finer steps read as one to the buyer. */
const STATES: Record<Exclude<FulfilmentState, "rejected" | "cancelled">, Omit<StatusView, "note">> = {
  new: { label: "Waiting for the shop", tone: "new", icon: "clock" },
  accepted: { label: "Accepted", tone: "info", icon: "box" },
  picking: { label: "Being prepared", tone: "info", icon: "box" },
  partially_available: { label: "Being prepared", tone: "info", icon: "box" },
  packed: { label: "Packed", tone: "info", icon: "box" },
  label_booked: { label: "Courier booked", tone: "info", icon: "truck" },
  courier_confirmed: { label: "Courier booked", tone: "info", icon: "truck" },
  handed_to_courier: { label: "On its way", tone: "info", icon: "truck" },
  in_transit: { label: "On its way", tone: "info", icon: "truck" },
  delivered: { label: "Delivered", tone: "success", icon: "check" },
  // Ready is the buyer's cue to come for it.
  ready_for_pickup: { label: "Ready for pickup", tone: "success", icon: "store" },
  collected: { label: "Collected", tone: "success", icon: "check" },
  // The hold expired (#32): the shop kept what was fresh, the rest is refunded.
  not_collected: { label: "Not collected", tone: "neutral", icon: "x" },
}

/** Paystack's refund statuses (`order_refund.status`). */
export type RefundStatus = "pending" | "processing" | "processed" | "failed" | "needs-attention"
export type OrderRefundView = { amount: number; status: RefundStatus }

const REFUNDS: Record<RefundStatus, StatusView> = {
  pending: { label: "Refund on its way", tone: "success", icon: "check", note: null },
  processing: { label: "Refund on its way", tone: "success", icon: "check", note: null },
  processed: { label: "Refunded", tone: "success", icon: "check", note: null },
  // The accept-deadline job refunds it again (#20).
  failed: { label: "Refund delayed", tone: "new", icon: "clock", note: "It didn't go through, so we're trying again." },
  // Paystack needs the buyer's bank account to retry it (#13); after 7 days Oja's team sends it.
  "needs-attention": {
    label: "Refund delayed · add your bank",
    tone: "attention",
    icon: "info",
    note: "Your bank couldn't take it back to your card. Add a bank account to receive it.",
  },
}

/** Where a rejected order's refund is, as its buyer reads it; null while there is none. */
export function refundStatus(refund: OrderRefundView | null): StatusView | null {
  return refund ? REFUNDS[refund.status] : null
}

/**
 * Where a refund an order owes its buyer is (#16): `retrying` while the retry job still tries
 * it, `manual` once Oja's team sends it themselves (Paystack can't make it, or every retry failed).
 */
export type OwedRefundState = "retrying" | "manual"

/** A refund the order owes its buyer and hasn't made (#16), and where it is. */
export type OwedRefundView = { amount: number; state: OwedRefundState }

/** Where a refund the order still owes is, as its buyer reads it; null while it owes none. */
export function owedRefundStatus(owed: OwedRefundView | null, currencyCode: string): StatusView | null {
  if (!owed) return null
  const amount = formatMoney(owed.amount, currencyCode)
  return {
    label: "Refund pending",
    tone: "new",
    icon: "clock",
    note: owed.state === "manual" ? `Our team is sending your ${amount} refund` : `Refund of ${amount} pending`,
  }
}

/** Where a shop's order is, as its buyer reads it; a rejected or cancelled order says why. */
export function orderStatus({ fulfilment }: { fulfilment: OrderFulfilmentView }): StatusView {
  if (fulfilment.state === "cancelled") {
    const { cancellation } = fulfilment
    const label = `Cancelled by ${cancelledBy(cancellation?.by ?? "seller")}`
    return { label, tone: "neutral", icon: "x", note: cancellation ? cancelReasonText(cancellation) : null }
  }
  if (fulfilment.state !== "rejected") return { ...STATES[fulfilment.state], note: null }
  if (fulfilment.rejected_by === "accept_deadline") return { label: "Not accepted in time", tone: "neutral", icon: "x", note: null }
  return { label: "Rejected by the shop", tone: "neutral", icon: "x", note: fulfilment.reject_reason }
}

type GroupLike<O> = { orders: readonly O[] }

/** One row of the order list: a checkout across several shops, or one shop's order on its own. */
export type HistoryEntry<G extends GroupLike<O>, O> =
  | { kind: "group"; group: G; paid_total: number }
  | { kind: "order"; group: G; order: O; paid_total: number }

/**
 * The order list's rows, in the order the groups come (newest first). A group of one order,
 * as paying for one shop's items on its own makes (#65), is shown as that order, with no group
 * level around it.
 */
export function historyEntries<O extends { paid_total: number }, G extends GroupLike<O>>(
  groups: readonly G[]
): HistoryEntry<G, O>[] {
  return groups.flatMap((group): HistoryEntry<G, O>[] => {
    const paid_total = group.orders.reduce((sum, o) => sum + o.paid_total, 0)
    const [only, ...others] = group.orders
    if (!only) return []
    return others.length ? [{ kind: "group", group, paid_total }] : [{ kind: "order", group, order: only, paid_total }]
  })
}
