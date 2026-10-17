import type { IPaymentModuleService } from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { fulfilmentService, type OrderRefundRecord } from "../../../lib/order-fulfilment"
import { paystackClient } from "../../../modules/paystack"
import { fromSubunit } from "../../../modules/paystack/client"
import { sessionIdOf } from "../../../modules/paystack/service"

export type RefundUnclaimedTransactionInput = { reference: string }

/**
 * Refunds in full a Paystack transaction whose payment session no longer exists: the buyer
 * paid on a Paystack page that a newer one had replaced (paying twice, or paying for items
 * since moved to another cart, #65). Medusa never records a payment for it, so no order can
 * claim it; the refund is made on Paystack directly and recorded with no order.
 */
const refundUnclaimedTransactionStep = createStep(
  "refund-unclaimed-transaction",
  async ({ reference }: RefundUnclaimedTransactionInput, { container }) => {
    const paystack = paystackClient()
    if (!paystack) return new StepResponse(null)
    const service = fulfilmentService(container)
    // Paystack sends a webhook more than once; a transaction is refunded once, unless that refund failed.
    const earlier = await service.listOrderRefunds({ transaction_reference: reference })
    if (earlier.some((refund) => refund.status !== "failed")) return new StepResponse(null)

    const transaction = await paystack.verify(reference)
    const sessionId = sessionIdOf(transaction)
    if (transaction.status !== "success" || !sessionId) return new StepResponse(null)
    // A live session is Mercur's to complete into orders.
    const sessions = await container.resolve<IPaymentModuleService>(Modules.PAYMENT).listPaymentSessions({ id: sessionId })
    if (sessions.length) return new StepResponse(null)

    const refund = await paystack.refund({ transaction: reference, merchant_note: `unclaimed:${reference}` })
    if (!refund.id) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Paystack refunded ${reference} without an id`)
    const recorded = await service.createOrderRefunds({
      order_id: null,
      payment_id: null,
      refund_id: null,
      amount: fromSubunit(refund.amount ?? transaction.amount),
      covers: "all",
      currency_code: transaction.currency.toLowerCase(),
      transaction_reference: reference,
      paystack_refund_id: String(refund.id),
      status: refund.status ?? "pending",
    })
    return new StepResponse(recorded as OrderRefundRecord | null)
  }
)

export const refundUnclaimedTransactionWorkflow = createWorkflow(
  "refund-unclaimed-transaction",
  (input: RefundUnclaimedTransactionInput) => {
    const key = transform({ input }, ({ input }) => `paystack-transaction:${input.reference}`)
    acquireLockStep({ key, timeout: 10, ttl: 60 })
    const refund = refundUnclaimedTransactionStep(input)
    releaseLockStep({ key })
    return new WorkflowResponse(refund)
  }
)
