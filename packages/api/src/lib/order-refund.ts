import { MathBN, MedusaError } from "@medusajs/framework/utils"
import type { OrderTransaction } from "./shop-order"

// A shop refunds its own order's share of what the buyer paid (#20). A checkout split across
// shops has one Paystack payment, and later an order may be paid by a payment of its own
// (#65), so the share is worked out from the order's own transactions, payment by payment:
// its `capture` transactions (the split records each at the order's share) less its `refund`
// transactions. Medusa only checks a refund against the whole payment.

/** An order's own transactions, and the payment each capture and refund in them belongs to. */
export type OrderMoney = {
  transactions: OrderTransaction[]
  paymentOfCapture: Map<string, string>
  paymentOfRefund: Map<string, string>
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
