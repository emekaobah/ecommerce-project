import type { FulfilmentState } from "./fulfilment"
import type { RefundStatus } from "./order-history"

/**
 * Whether a shop's order is still happening for its buyer (#59): the Orders tab lists orders
 * `in_progress` above `past` ones. Stored on the order's fulfilment row by every writer of its
 * state or its refunds, so order history can filter by it.
 */
export const ORDER_PHASES = ["in_progress", "past"] as const
export type OrderPhase = (typeof ORDER_PHASES)[number]

/** An order's refund, as much of it as its phase reads; `handed_over`: to Oja's team, to send by hand (#13). */
export type PhaseRefund = { status: RefundStatus; handed_over: boolean }

/** The states an order never leaves. */
const FINAL: ReadonlySet<FulfilmentState> = new Set(["rejected", "cancelled", "delivered", "collected", "not_collected"])

/** A refund that waits on the buyer for a bank account to retry it to (#13), and Oja's team hasn't taken over. */
const waitsOnBuyer = (refund: PhaseRefund) => refund.status === "needs-attention" && !refund.handed_over

/**
 * In progress while the order's state isn't final, or while a refund waits on its buyer for bank
 * details; otherwise past. A refund still moving (pending, failed and owed again, or with Oja's
 * team) shows as a chip and doesn't hold the order.
 */
export function orderPhase(state: FulfilmentState, refunds: readonly PhaseRefund[]): OrderPhase {
  return !FINAL.has(state) || refunds.some(waitsOnBuyer) ? "in_progress" : "past"
}
