import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MathBN } from "@medusajs/framework/utils"
import type { OwedRefundState } from "@oja/domain"
import type { RefundCovers } from "../modules/order-fulfilment/models/order-refund"
import { fulfilmentService, fulfilmentsOf } from "./order-fulfilment"
import { owedToBuyerOf, shareLeft, type OrderSummary } from "./order-refund"
import type { OrderTransaction } from "./shop-order"

// What an order owes its buyer and hasn't refunded (#16): lines an order edit removed (#22,
// #32) whose refund Paystack refused, or that was never made, or all that is left of the share
// of an accepted order that was cancelled (#17). An edit's amount stays derived from Medusa's
// order summary (`owedToBuyerOf`), less any refund Paystack made that failed to be recorded on
// the order; a cancelled order's from its captures less its refunds (`shareLeft`). Either is
// less what Oja's team settled by hand (`refund_settlement`). Each refused attempt is an
// `order_refund` row that `failed`, with Paystack's reason.

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

/** A settlement by hand (`refund_settlement`), as much of it as an owed refund reads. */
export type SettlementRow = { amount: number; created_at: Date | string }

/** When a refund or settlement was recorded, in milliseconds. */
const recordedAt = (row: { created_at: Date | string }) => new Date(row.created_at).getTime()

/**
 * The refunds that failed since one was last made, or since `after`, oldest first: tries at the
 * same refund, refused by Paystack or failed after it accepted them.
 */
export function failedSinceLastMade<R extends { status: string; created_at: Date | string }>(refunds: R[], after = -Infinity): R[] {
  const lastMade = Math.max(after, ...refunds.filter((r) => r.status !== "failed").map(recordedAt))
  return refunds.filter((r) => r.status === "failed" && recordedAt(r) > lastMade).sort((a, b) => recordedAt(a) - recordedAt(b))
}

/**
 * What the order still owes its buyer and where its refund is; null when it owes nothing. The
 * attempts are its refunds of what it owes (of its items, or of all of a cancelled order's
 * share; never of delivery alone, which Oja's staff refund) that failed since one last went
 * through, or since Oja's team last settled what it owed by hand: refused by Paystack, or
 * accepted and failed later (its money came back, so it is owed again).
 */
export function owedRefund({
  owed,
  settlements,
  refunds,
}: {
  owed: number
  settlements: SettlementRow[]
  refunds: RefundAttemptRow[]
}): OwedRefund | null {
  const settled = settlements.reduce((sum, s) => MathBN.convert(MathBN.add(sum, s.amount)).toNumber(), 0)
  const amount = MathBN.convert(MathBN.sub(owed, settled)).toNumber()
  if (amount <= 0) return null
  const lastSettled = Math.max(-Infinity, ...settlements.map(recordedAt))
  const failed = failedSinceLastMade(
    refunds.filter((r) => r.covers !== "delivery"),
    lastSettled
  )
  const latest = failed.at(-1)
  const base = { amount, attempts: failed.length, last_error: latest?.failure_reason ?? null }
  if (amount < PAYSTACK_MIN_REFUND || failed.length > OWED_REFUND_BACKOFF_MS.length) {
    return { ...base, state: "manual", next_attempt_at: null }
  }
  const wait = latest ? OWED_REFUND_BACKOFF_MS[failed.length - 1] : undefined
  return { ...base, state: "retrying", next_attempt_at: latest && wait != null ? new Date(recordedAt(latest) + wait) : null }
}

/** Whether the retry job tries the owed refund at `now`. */
export function isDue(owed: OwedRefund, now: Date): boolean {
  return owed.state === "retrying" && (!owed.next_attempt_at || owed.next_attempt_at.getTime() <= now.getTime())
}

type Scope = Pick<MedusaContainer, "resolve">

/**
 * What an owed refund is a refund of: lines an order edit removed (`items`), or all that is left
 * of a cancelled order's share (`all`, #17).
 */
export type OwedCovers = Extract<RefundCovers, "items" | "all">

/** An order's owed refund, the order's currency, and what the refund is of. */
export type OrderOwedRefund = OwedRefund & { order_id: string; currency_code: string; covers: OwedCovers }

type OrderRow = {
  id: string
  currency_code: string
  summary?: OrderSummary
  transactions?: OrderTransaction[] | null
}

/**
 * What Paystack refunded of the order's items that isn't recorded on the order: recording a
 * refund it made failed (`refundOrderShare`), so the order's summary still counts it as owed.
 */
function unrecordedRefunds(order: OrderRow, refunds: { refund_id: string | null; covers: RefundCovers; status: string; amount: number }[]) {
  const recorded = new Set((order.transactions ?? []).filter((t) => t.reference === "refund").map((t) => t.reference_id))
  return refunds
    .filter((r) => r.covers === "items" && r.status !== "failed" && r.refund_id && !recorded.has(r.refund_id))
    .reduce((sum, r) => MathBN.convert(MathBN.add(sum, r.amount)).toNumber(), 0)
}

/** Each order's owed refund (`owedRefund`); an order owing its buyer nothing is left out. */
export async function owedRefundsOf(scope: Scope, orderIds: string[]): Promise<Map<string, OrderOwedRefund>> {
  if (!orderIds.length) return new Map()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const [{ data }, refunds, settlements, fulfilments] = await Promise.all([
    query.graph({
      entity: "order",
      fields: ["id", "currency_code", "summary", "transactions.amount", "transactions.reference", "transactions.reference_id"],
      filters: { id: orderIds },
    }),
    fulfilmentService(scope).listOrderRefunds({ order_id: orderIds }),
    fulfilmentService(scope).listRefundSettlements({ order_id: orderIds }),
    fulfilmentsOf(scope, orderIds),
  ])
  const owed = new Map<string, OrderOwedRefund>()
  for (const order of data as unknown as OrderRow[]) {
    const ofOrder = refunds.filter((r) => r.order_id === order.id)
    const cancelled = fulfilments.get(order.id)?.state === "cancelled"
    const covers: OwedCovers = cancelled ? "all" : "items"
    const amount = cancelled
      ? shareLeft({ transactions: (order.transactions ?? []).map((t) => ({ ...t, amount: Number(t.amount) })), refunds: ofOrder })
      : MathBN.convert(MathBN.sub(owedToBuyerOf(order.summary), unrecordedRefunds(order, ofOrder))).toNumber()
    const found = owedRefund({
      owed: amount,
      settlements: settlements.filter((s) => s.order_id === order.id),
      refunds: ofOrder,
    })
    if (found) owed.set(order.id, { ...found, order_id: order.id, currency_code: order.currency_code, covers })
  }
  return owed
}

/** The order's owed refund (`owedRefundsOf`); null when it owes its buyer nothing. */
export async function owedRefundOf(scope: Scope, orderId: string): Promise<OrderOwedRefund | null> {
  return (await owedRefundsOf(scope, [orderId])).get(orderId) ?? null
}

/**
 * Every order that owes its buyer a refund. Only an order edit (#22, #32) or cancelling an
 * accepted order (#17) leaves an order owing its buyer, so only orders with a confirmed edit,
 * and cancelled orders, are worked out.
 */
export async function allOwedRefunds(scope: Scope): Promise<OrderOwedRefund[]> {
  const [{ data }, cancelled] = await Promise.all([
    scope.resolve(ContainerRegistrationKeys.QUERY).graph({
      entity: "order_change",
      fields: ["order_id"],
      filters: { change_type: "edit", status: "confirmed" },
    }),
    fulfilmentService(scope).listOrderFulfilments({ state: "cancelled" }, { select: ["order_id"] }),
  ])
  const ids = [...new Set([...(data as unknown as { order_id: string }[]), ...cancelled].map((c) => c.order_id))]
  return [...(await owedRefundsOf(scope, ids)).values()]
}
