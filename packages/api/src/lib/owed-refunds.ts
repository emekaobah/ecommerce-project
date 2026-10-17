import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MathBN, MedusaError } from "@medusajs/framework/utils"
import type { OwedRefundState } from "@oja/domain"
import type { RefundCovers } from "../modules/order-fulfilment/models/order-refund"
import { cancelledOnceAccepted, fulfilmentService, fulfilmentsOf } from "./order-fulfilment"
import { owedToBuyerOf, refundMade, shareLeft, totalOf, type OrderSummary } from "./order-refund"
import { transactionsOf, type OrderTransaction } from "./shop-order"

// What an order owes its buyer and hasn't refunded (#16): lines an order edit removed (#22,
// #32) whose refund Paystack refused, or that was never made, or all that is left of the share
// of an accepted order that was cancelled (#17). An edit's amount stays derived from Medusa's
// order summary (`owedToBuyerOf`), less any refund Paystack made that failed to be recorded on
// the order; a cancelled order's from its captures less its refunds (`shareLeft`). Either is
// less what Oja's team settled by hand (`refund_settlement`). Each refused attempt is an
// `order_refund` row that `failed`, with Paystack's reason. A refund that needed the buyer's
// bank account and was handed to Oja's team (#13) is owed too, by hand; the rest of what the
// order owes is still Paystack's to try.

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
  /**
   * What of it Oja's team sends by hand already: refunds handed to them when the buyer gave no
   * bank account (#13), since they last settled what the order owed. The rest is Paystack's to
   * try while `retrying` (`paystackPart`).
   */
  by_hand: number
  /** Failed attempts since a refund of items last went through. */
  attempts: number
  /** Paystack's reason for refusing the latest attempt; null when it gave none or none failed. */
  last_error: string | null
  /** `manual` once all of it is Oja's team's to send by hand. */
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
  amount?: unknown
  handed_over_at?: Date | string | null
}

/** Why a refund that needed the buyer's bank account was handed to Oja's team (#13). */
export const NO_ACCOUNT_REASON = "The buyer gave no bank account in 7 days"

/**
 * A refund that needed the buyer's bank account and was handed to Oja's team (#13): Paystack
 * still holds it (it counts as refunded on the order), and Oja's team owes it to the buyer by
 * hand until Paystack settles it or the team marks it settled.
 */
export const handedOver = (r: Pick<RefundAttemptRow, "status" | "handed_over_at">) => !!r.handed_over_at && r.status === "needs-attention"

/** A refund that needs the buyer's bank account (#13), and Oja's team hasn't taken over. */
export const needsAccount = (r: Pick<RefundAttemptRow, "status" | "handed_over_at">) => r.status === "needs-attention" && !r.handed_over_at

/**
 * When the refund last came to need attention (ISO 8601; empty if it never has), which keys
 * what is sent about it: once each time it needs attention.
 */
export const needsAttentionSince = (r: { needs_attention_at?: Date | string | null }) =>
  r.needs_attention_at ? new Date(r.needs_attention_at).toISOString() : ""

/** A settlement by hand (`refund_settlement`), as much of it as an owed refund reads. */
export type SettlementRow = { amount: number; created_at: Date | string }

/** When a refund or settlement was recorded, in milliseconds. */
const recordedAt = (row: { created_at: Date | string }) => new Date(row.created_at).getTime()

/**
 * The refunds that failed since one was last made (`refundMade`), or since `after`, oldest
 * first: tries at the same refund, refused by Paystack or failed after it accepted them.
 */
export function failedSinceLastMade<R extends { status: string; created_at: Date | string }>(refunds: R[], after = -Infinity): R[] {
  const lastMade = Math.max(after, ...refunds.filter(refundMade).map(recordedAt))
  return refunds.filter((r) => !refundMade(r) && recordedAt(r) > lastMade).sort((a, b) => recordedAt(a) - recordedAt(b))
}

/** What of the owed refund Paystack is asked for: all of it but what Oja's team sends by hand. */
export const paystackPart = (owed: Pick<OwedRefund, "amount" | "by_hand">) => MathBN.convert(MathBN.sub(owed.amount, owed.by_hand)).toNumber()

/** What of the owed refund is Oja's team's to send by hand: all of it once `manual`. */
export const teamPart = (owed: Pick<OwedRefund, "amount" | "by_hand" | "state">) => (owed.state === "manual" ? owed.amount : owed.by_hand)

/**
 * What the order still owes its buyer and where its refund is; null when it owes nothing. The
 * attempts are its refunds of what it owes (of its items, or of all of a cancelled order's
 * share; never of delivery alone, which Oja's staff refund) that failed since one last went
 * through, or since Oja's team last settled what it owed by hand: refused by Paystack, or
 * accepted and failed later (its money came back, so it is owed again). What Paystack is asked
 * for (`paystackPart`) is retried with backoff, and handed to Oja's team once it can't be made.
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
  const handed = refunds.filter(handedOver)
  const amount = MathBN.convert(MathBN.sub(MathBN.add(owed, totalOf(handed.map((r) => r.amount ?? 0))), totalOf(settlements.map((s) => s.amount)))).toNumber()
  if (amount <= 0) return null
  // A settlement is of all the order owed then, so it settled every refund handed over before it.
  const lastSettled = Math.max(-Infinity, ...settlements.map(recordedAt))
  const byHand = Math.min(amount, totalOf(handed.filter((r) => new Date(r.handed_over_at!).getTime() > lastSettled).map((r) => r.amount ?? 0)))
  const failed = failedSinceLastMade(
    refunds.filter((r) => r.covers !== "delivery"),
    lastSettled
  )
  const latest = failed.at(-1)
  const toPaystack = paystackPart({ amount, by_hand: byHand })
  const base = {
    amount,
    by_hand: byHand,
    attempts: failed.length,
    last_error: latest?.failure_reason ?? (toPaystack <= 0 ? NO_ACCOUNT_REASON : null),
  }
  if (toPaystack < PAYSTACK_MIN_REFUND || failed.length > OWED_REFUND_BACKOFF_MS.length) {
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
  return totalOf(refunds.filter((r) => r.covers === "items" && refundMade(r) && r.refund_id && !recorded.has(r.refund_id)).map((r) => r.amount))
}

/** Each order's currency and what it owes its buyer (null for nothing), `cancelled` saying which orders were cancelled. */
async function owedOfOrders(
  scope: Scope,
  orderIds: string[],
  cancelled?: (orderId: string) => boolean
): Promise<Map<string, { currency_code: string; covers: OwedCovers; owed: OwedRefund | null }>> {
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
    fulfilmentsOf(scope, cancelled ? [] : orderIds),
  ])
  const isCancelled = cancelled ?? ((orderId: string) => cancelledOnceAccepted(fulfilments.get(orderId)))
  const owed = new Map<string, { currency_code: string; covers: OwedCovers; owed: OwedRefund | null }>()
  for (const order of data as unknown as OrderRow[]) {
    const ofOrder = refunds.filter((r) => r.order_id === order.id)
    const all = isCancelled(order.id)
    const amount = all
      ? shareLeft({ transactions: transactionsOf(order), refunds: ofOrder })
      : MathBN.convert(MathBN.sub(owedToBuyerOf(order.summary), unrecordedRefunds(order, ofOrder))).toNumber()
    owed.set(order.id, {
      currency_code: order.currency_code,
      covers: all ? "all" : "items",
      owed: owedRefund({ owed: amount, settlements: settlements.filter((s) => s.order_id === order.id), refunds: ofOrder }),
    })
  }
  return owed
}

/** Each order's owed refund (`owedRefund`); an order owing its buyer nothing is left out. */
export async function owedRefundsOf(scope: Scope, orderIds: string[]): Promise<Map<string, OrderOwedRefund>> {
  const owed = new Map<string, OrderOwedRefund>()
  for (const [orderId, { owed: found, ...of }] of await owedOfOrders(scope, orderIds)) {
    if (found) owed.set(orderId, { ...found, ...of, order_id: orderId })
  }
  return owed
}

/** The order's owed refund (`owedRefundsOf`); null when it owes its buyer nothing. */
export async function owedRefundOf(scope: Scope, orderId: string): Promise<OrderOwedRefund | null> {
  return (await owedRefundsOf(scope, [orderId])).get(orderId) ?? null
}

/**
 * What cancelling the order refunds its buyer (#17), and its currency: what it would owe once
 * cancelled (all that is left of its share, less what Oja's team settled by hand), but what
 * Oja's team already sends by hand (`paystackPart`). The refund made on cancelling is of this.
 */
export async function cancelRefundOf(scope: Scope, orderId: string): Promise<{ amount: number; currency_code: string }> {
  const found = (await owedOfOrders(scope, [orderId], () => true)).get(orderId)
  if (!found) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${orderId} was not found`)
  return { amount: found.owed ? Math.max(paystackPart(found.owed), 0) : 0, currency_code: found.currency_code }
}

/**
 * Every order that owes its buyer a refund. Only an order edit (#22, #32), cancelling an
 * accepted order (#17), or a refund handed to Oja's team when the buyer gave no bank account
 * (#13) leaves an order owing its buyer, so only orders with a confirmed edit, cancelled
 * orders, and orders with such a refund are worked out.
 */
export async function allOwedRefunds(scope: Scope): Promise<OrderOwedRefund[]> {
  const [{ data }, cancelled, handed] = await Promise.all([
    scope.resolve(ContainerRegistrationKeys.QUERY).graph({
      entity: "order_change",
      fields: ["order_id"],
      filters: { change_type: "edit", status: "confirmed" },
    }),
    fulfilmentService(scope).listOrderFulfilments({ state: "cancelled" }, { select: ["order_id"] }),
    fulfilmentService(scope).listOrderRefunds({ status: "needs-attention", handed_over_at: { $ne: null } }, { select: ["order_id"] }),
  ])
  const ids = [
    ...new Set([
      ...[...(data as unknown as { order_id: string }[]), ...cancelled].map((c) => c.order_id),
      ...handed.flatMap((r) => (r.order_id ? [r.order_id] : [])),
    ]),
  ]
  return [...(await owedRefundsOf(scope, ids)).values()]
}
