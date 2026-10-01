import type { IOrderModuleService, IPaymentModuleService } from "@medusajs/framework/types"
import { MathBN, Modules } from "@medusajs/framework/utils"
import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import type { OrderRefundRecord } from "../../../lib/order-fulfilment"
import { refundPayment } from "../steps/refund-payment"

export type RefundUnclaimedPaymentInput = { payment_id: string }

/**
 * Refunds in full what is left of a captured payment that no order claims: the checkout was
 * paid but never split into orders (e.g. stock ran out before Paystack's webhook, ADR 0003).
 * A payment some order claims, through a `capture` transaction, is that order's to refund.
 */
const refundUnclaimedPaymentStep = createStep(
  "refund-unclaimed-payment",
  async ({ payment_id }: RefundUnclaimedPaymentInput, { container }) => {
    const [payment] = await container
      .resolve<IPaymentModuleService>(Modules.PAYMENT)
      .listPayments({ id: payment_id }, { relations: ["captures", "refunds"] })
    const captureIds = (payment?.captures ?? []).map((c) => c.id)
    if (!captureIds.length) return new StepResponse(null)
    const claims = await container
      .resolve<IOrderModuleService>(Modules.ORDER)
      .listOrderTransactions({ reference: "capture", reference_id: captureIds })
    if (claims.length) return new StepResponse(null)
    const sum = (items: { amount: unknown }[]) => items.reduce((total, i) => MathBN.add(total, i.amount as number), MathBN.convert(0))
    const left = MathBN.sub(sum(payment.captures ?? []), sum(payment.refunds ?? [])).toNumber()
    if (left <= 0) return new StepResponse(null)
    const { recorded } = await refundPayment(container, {
      payment_id,
      amount: left,
      currency_code: payment.currency_code,
      order_id: null,
      earlier_refund_ids: (payment.refunds ?? []).map((r) => r.id),
      note: "Paid, but no order was placed",
    })
    return new StepResponse(recorded as OrderRefundRecord | null)
  }
)

export const refundUnclaimedPaymentWorkflow = createWorkflow("refund-unclaimed-payment", (input: RefundUnclaimedPaymentInput) => {
  // The same lock as an order's refund of its share, so the two never race on one payment.
  const key = transform({ input }, ({ input }) => [`payment-refund:${input.payment_id}`])
  acquireLockStep({ key, timeout: 10, ttl: 60 })
  const refund = refundUnclaimedPaymentStep(input)
  releaseLockStep({ key })
  return new WorkflowResponse(refund)
})
