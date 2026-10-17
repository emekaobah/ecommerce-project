import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MathBN, MedusaError } from "@medusajs/framework/utils"
import type { RefundCovers } from "../modules/order-fulfilment/models/order-refund"
import { fulfilmentService } from "./order-fulfilment"
import type { OrderTransaction } from "./shop-order"

// A shop refunds its own order's share of what the buyer paid (#20). A checkout split across
// shops has one Paystack payment, and later an order may be paid by a payment of its own
// (#65), so the share is worked out from the order's own transactions, payment by payment:
// its `capture` transactions (the split records each at the order's share) less its `refund`
// transactions. Medusa only checks a refund against the whole payment.

type Scope = Pick<MedusaContainer, "resolve">

/** An order's own transactions, and the payment each capture and refund in them belongs to. */
export type OrderMoney = {
  transactions: OrderTransaction[]
  paymentOfCapture: Map<string, string>
  paymentOfRefund: Map<string, string>
}

/** The order graph's `summary`, of which only what the order owes either way is read. */
export type OrderSummary = { pending_difference?: unknown } | null

/**
 * What the order owes its buyer and hasn't refunded: its pending difference when negative. An
 * order edit that removes lines (#22, #32) leaves the order owing what they cost, until a
 * refund of items pays it off.
 */
export function owedToBuyerOf(summary?: OrderSummary): number {
  return MathBN.convert(MathBN.max(MathBN.mult(Number(summary?.pending_difference ?? 0), -1), 0)).toNumber()
}

/** What is left to refund of an order's items and of its delivery fee (#22). */
export type RefundableShare = { items: number; delivery: number }

/**
 * What is left to refund of the order's items (what was captured, less the delivery fee and
 * the refunds of items) and of its delivery fee (less the refunds of delivery), neither more
 * than is left of the order's share (a refund of all covers both). A refund that failed gave
 * its money back, so it isn't counted.
 */
export function refundableShare({
  transactions,
  deliveryFee,
  refunds,
}: {
  transactions: OrderTransaction[]
  deliveryFee: number
  refunds: { amount: unknown; covers: RefundCovers; status: string }[]
}): RefundableShare {
  const total = (amounts: unknown[]) => amounts.reduce<ReturnType<typeof MathBN.convert>>((sum, a) => MathBN.add(sum, Number(a)), MathBN.convert(0))
  const captured = total(transactions.filter((t) => t.reference === "capture").map((t) => t.amount))
  const made = refunds.filter((r) => r.status !== "failed")
  const ofDelivery = total(made.filter((r) => r.covers === "delivery").map((r) => r.amount))
  const ofItems = total(made.filter((r) => r.covers !== "delivery").map((r) => r.amount))
  const share = MathBN.sub(MathBN.sub(captured, ofDelivery), ofItems)
  const left = (amount: Parameters<typeof MathBN.convert>[0]) => MathBN.convert(MathBN.max(MathBN.min(amount, share), 0)).toNumber()
  return {
    items: left(MathBN.sub(MathBN.sub(captured, deliveryFee), ofItems)),
    delivery: left(MathBN.sub(deliveryFee, ofDelivery)),
  }
}

/** An order's delivery fee, and what is left of it to refund (#22). */
export type DeliveryRefundable = { currency_code: string; delivery_fee: number; left: number }

/** What is left to refund of the order's items and of its delivery fee (`refundableShare`), and its delivery fee. */
export async function refundableShareOf(scope: Scope, orderId: string): Promise<RefundableShare & Omit<DeliveryRefundable, "left">> {
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "order",
    fields: ["id", "currency_code", "shipping_total", "transactions.amount", "transactions.reference", "transactions.reference_id"],
    filters: { id: orderId },
  })
  const order = data[0] as unknown as
    | { currency_code: string; shipping_total?: unknown; transactions?: OrderTransaction[] | null }
    | undefined
  if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${orderId} was not found`)
  const deliveryFee = Number(order.shipping_total ?? 0)
  const share = refundableShare({
    transactions: (order.transactions ?? []).map((t) => ({ ...t, amount: Number(t.amount) })),
    deliveryFee,
    refunds: await fulfilmentService(scope).listOrderRefunds({ order_id: orderId }),
  })
  return { ...share, currency_code: order.currency_code, delivery_fee: deliveryFee }
}

/** The order's delivery fee and what is left of it to refund, which Oja's staff refund (`POST /admin/orders/:id/delivery-refund`). */
export async function deliveryRefundableOf(scope: Scope, orderId: string): Promise<DeliveryRefundable> {
  const { currency_code, delivery_fee, delivery } = await refundableShareOf(scope, orderId)
  return { currency_code, delivery_fee, left: delivery }
}

/** One refund to make: an amount of one payment. */
export type RefundPart = { payment_id: string; amount: number }

export class RefundExceedsShareError extends MedusaError {
  constructor(requested: number, refundable: number) {
    super(
      MedusaError.Types.NOT_ALLOWED,
      `A refund of ${requested} is more than the order's share of its payment still refundable (${refundable})`
    )
  }
}

/** What the order may still refund of each of its payments, in the order first captured. */
function refundableByPayment({ transactions, paymentOfCapture, paymentOfRefund }: OrderMoney) {
  const left = new Map<string, ReturnType<typeof MathBN.convert>>()
  const add = (paymentId: string | undefined, amount: number) => {
    if (paymentId) left.set(paymentId, MathBN.add(left.get(paymentId) ?? 0, amount))
  }
  for (const t of transactions) {
    if (t.reference === "capture") add(paymentOfCapture.get(t.reference_id ?? ""), t.amount)
  }
  // Refund transactions are negative, so adding them takes them off.
  for (const t of transactions) {
    if (t.reference === "refund") add(paymentOfRefund.get(t.reference_id ?? ""), t.amount)
  }
  return [...left].map(([payment_id, amount]) => ({ payment_id, amount: MathBN.convert(amount).toNumber() }))
}

/**
 * The refunds that return `requested` of the order's share, taken from its payments in turn;
 * all of what is left of the share when nothing is asked for. Never more than the share.
 */
export function refundPlan(money: OrderMoney, requested?: number): RefundPart[] {
  if (requested != null && requested <= 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "A refund must be greater than 0")
  }
  const refundable = refundableByPayment(money).filter((p) => p.amount > 0)
  const total = MathBN.convert(refundable.reduce((sum, p) => MathBN.add(sum, p.amount), MathBN.convert(0))).toNumber()
  if (requested != null && MathBN.gt(requested, total)) throw new RefundExceedsShareError(requested, total)

  let wanted = MathBN.convert(requested ?? total)
  const plan: RefundPart[] = []
  for (const part of refundable) {
    if (MathBN.lte(wanted, 0)) break
    const amount = MathBN.min(wanted, part.amount)
    plan.push({ payment_id: part.payment_id, amount: MathBN.convert(amount).toNumber() })
    wanted = MathBN.sub(wanted, amount)
  }
  return plan
}
