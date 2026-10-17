import { MathBN } from "@medusajs/framework/utils"
import type { RefundCovers } from "../modules/order-fulfilment/models/order-refund"

// What an order owes its buyer and hasn't refunded (#16): lines an order edit removed (#22,
// #32) whose refund Paystack refused, or that was never made. The amount stays derived from
// Medusa's order summary (`owedToBuyerOf`), less what Oja's team settled by hand. Each refused
// attempt is an `order_refund` row that `failed`, with Paystack's reason.

/** Paystack refuses every refund under ₦50; such an amount goes straight to Oja's team. */
export const PAYSTACK_MIN_REFUND = 50

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

/**
 * How long to wait after each failed attempt before the next: 5 minutes after the first, an
 * hour after the second, 6 hours after the third. Once the attempt after that fails too, the
 * refund is handed to Oja's team.
 */
export const OWED_REFUND_BACKOFF_MS = [5 * MINUTE, HOUR, 6 * HOUR]

/**
 * Where an owed refund is: `retrying` while the retry job still tries it, `manual` once Oja's
 * team sends it themselves (Paystack can't make it, or every retry failed).
 */
export type OwedRefundState = "retrying" | "manual"

export type OwedRefund = {
  /** What is still owed: the order's owed amount less what was settled by hand. */
  amount: number
  /** Failed attempts since a refund of items last went through. */
  attempts: number
  /** Paystack's reason for refusing the latest attempt; null when it gave none or none failed. */
  last_error: string | null
  state: OwedRefundState
  /** When the retry job next tries it; null to try it now, or when it is no longer retried. */
  next_attempt_at: Date | null
}

/** An order's refund (`order_refund`), as much of it as an owed refund reads. */
export type RefundAttemptRow = {
  covers: RefundCovers
  status: string
  created_at: Date | string
  failure_reason?: string | null
}

/**
 * What the order still owes its buyer and where its refund is; null when it owes nothing. The
 * attempts are its refunds of items that failed since one last went through: refused by
 * Paystack, or accepted and failed later (its money came back, so it is owed again).
 */
export function owedRefund({
  owed,
  settled,
  refunds,
}: {
  owed: number
  settled: number
  refunds: RefundAttemptRow[]
}): OwedRefund | null {
  const amount = MathBN.convert(MathBN.sub(owed, settled)).toNumber()
  if (amount <= 0) return null
  const time = (r: RefundAttemptRow) => new Date(r.created_at).getTime()
  const ofItems = refunds.filter((r) => r.covers === "items")
  const lastMade = Math.max(-Infinity, ...ofItems.filter((r) => r.status !== "failed").map(time))
  const failed = ofItems.filter((r) => r.status === "failed" && time(r) > lastMade).sort((a, b) => time(a) - time(b))
  const latest = failed.at(-1)
  const base = { amount, attempts: failed.length, last_error: latest?.failure_reason ?? null }
  if (amount < PAYSTACK_MIN_REFUND || failed.length > OWED_REFUND_BACKOFF_MS.length) {
    return { ...base, state: "manual", next_attempt_at: null }
  }
  const wait = latest ? OWED_REFUND_BACKOFF_MS[failed.length - 1] : undefined
  return { ...base, state: "retrying", next_attempt_at: latest && wait != null ? new Date(time(latest) + wait) : null }
}

/** Whether the retry job tries the owed refund at `now`. */
export function isDue(owed: OwedRefund, now: Date): boolean {
  return owed.state === "retrying" && (!owed.next_attempt_at || owed.next_attempt_at.getTime() <= now.getTime())
}
