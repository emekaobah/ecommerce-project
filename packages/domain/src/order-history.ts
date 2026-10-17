import type { FulfilmentState } from "./fulfilment"
import { formatMoney } from "./money"

/**
 * How the buyer app shows its order history (#17): each checkout is an order group, split into
 * one order per shop, each with its own state, and its refund if the shop rejected it.
 */

/** A status chip's colour; the app pairs it with a symbol and the label. */
export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger"

export type OrderFulfilmentView = {
  state: FulfilmentState
  rejected_by: "seller" | "accept_deadline" | null
  reject_reason: string | null
}

/** A label for a status chip, and a line to say more under it. */
export type StatusView = { label: string; tone: StatusTone; note: string | null }

/** What the buyer is told of each state; staff's finer steps read as one to the buyer. */
const STATES: Record<Exclude<FulfilmentState, "rejected">, Omit<StatusView, "note">> = {
  new: { label: "Waiting for the shop", tone: "warning" },
  accepted: { label: "Accepted", tone: "info" },
  picking: { label: "Being prepared", tone: "info" },
  partially_available: { label: "Being prepared", tone: "info" },
  packed: { label: "Packed", tone: "info" },
  label_booked: { label: "Courier booked", tone: "info" },
  courier_confirmed: { label: "Courier booked", tone: "info" },
  handed_to_courier: { label: "On its way", tone: "info" },
  in_transit: { label: "On its way", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  // Ready is the buyer's cue to come for it.
  ready_for_pickup: { label: "Ready for pickup", tone: "success" },
  collected: { label: "Collected", tone: "success" },
  // The hold expired (#32): the shop kept what was fresh, the rest is refunded.
  not_collected: { label: "Not collected", tone: "danger" },
}

/** Paystack's refund statuses (`order_refund.status`). */
export type RefundStatus = "pending" | "processing" | "processed" | "failed" | "needs-attention"
export type OrderRefundView = { amount: number; status: RefundStatus }

const REFUNDS: Record<RefundStatus, StatusView> = {
  pending: { label: "Refund on its way", tone: "info", note: null },
  processing: { label: "Refund on its way", tone: "info", note: null },
  processed: { label: "Refunded", tone: "success", note: null },
  // The accept-deadline job refunds it again (#20).
  failed: { label: "Refund delayed", tone: "warning", note: "It didn't go through, so we're trying again." },
  // Paystack needs the buyer's bank account to retry it; until #72 an operator does that.
  "needs-attention": {
    label: "Refund delayed",
    tone: "warning",
    note: "Your bank couldn't take it back to your card. We'll contact you to finish it.",
  },
}

/** Where a rejected order's refund is, as its buyer reads it; null while there is none. */
export function refundStatus(refund: OrderRefundView | null): StatusView | null {
  return refund ? REFUNDS[refund.status] : null
}

/**
 * A refund the order owes its buyer and hasn't made (#16): Paystack refused it, so it is being
 * retried, or Oja's team is sending it by hand (`manual`).
 */
export type OwedRefundView = { amount: number; state: "retrying" | "manual" }

/** Where a refund the order still owes is, as its buyer reads it; null while it owes none. */
export function owedRefundStatus(owed: OwedRefundView | null, currencyCode: string): StatusView | null {
  if (!owed) return null
  const amount = formatMoney(owed.amount, currencyCode)
  return {
    label: "Refund pending",
    tone: "warning",
    note: owed.state === "manual" ? `Our team is sending your ${amount} refund` : `Refund of ${amount} pending`,
  }
}

/** Where a shop's order is, as its buyer reads it; a rejected order says why. */
export function orderStatus({ fulfilment }: { fulfilment: OrderFulfilmentView }): StatusView {
  if (fulfilment.state !== "rejected") return { ...STATES[fulfilment.state], note: null }
  if (fulfilment.rejected_by === "accept_deadline") return { label: "Not accepted in time", tone: "danger", note: null }
  return { label: "Rejected by the shop", tone: "danger", note: fulfilment.reject_reason }
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
