import type { IPaymentModuleService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { fulfilmentService, type OrderRefundRecord } from "../../../lib/order-fulfilment"
import { paystackClient } from "../../../modules/paystack"
import { fromSubunit } from "../../../modules/paystack/client"
import { paidInFull, sessionIdOf, type PaystackSessionData } from "../../../modules/paystack/service"

export type RefundUnclaimedTransactionInput = { reference: string }

export type RefundUnclaimedTransactionResult = {
  /** The refund made, if the transaction was refunded now. */
  refund: OrderRefundRecord | null
  /** The live payment session a successful transaction paid in full: Mercur's to complete into orders. */
  live_session_id: string | null
}

/**
 * Refunds in full a successful Paystack transaction that can't become orders, on Paystack
 * directly, and records it with no order. Medusa never records a payment for it:
 * - its payment session no longer exists: the buyer paid on a Paystack page a newer one had
 *   replaced (paying twice, or paying for items since moved to another cart, #65);
 * - it took a different amount or currency than its session started (#38), which the provider
 *   refuses to authorise: a bug or tampering, so it is logged loudly.
 * A transaction paid in full for a live session is left to Mercur, and named in the result.
 */
const refundUnclaimedTransactionStep = createStep(
  "refund-unclaimed-transaction",
  async ({ reference }: RefundUnclaimedTransactionInput, { container }) => {
    const none = (live_session_id: string | null = null) =>
      new StepResponse<RefundUnclaimedTransactionResult>({ refund: null, live_session_id })
    const paystack = paystackClient()
    if (!paystack) return none()
    const service = fulfilmentService(container)
    // Paystack sends a webhook more than once; a transaction is refunded once, unless that refund failed.
    const earlier = await service.listOrderRefunds({ transaction_reference: reference })
    if (earlier.some((refund) => refund.status !== "failed")) return none()

    const transaction = await paystack.verify(reference)
    const sessionId = sessionIdOf(transaction)
    if (transaction.status !== "success" || !sessionId) return none()
    const [session] = await container.resolve<IPaymentModuleService>(Modules.PAYMENT).listPaymentSessions({ id: sessionId })
    if (session) {
      const started = session.data as unknown as PaystackSessionData
      if (paidInFull(started, transaction)) return none(session.id)
      container
        .resolve(ContainerRegistrationKeys.LOGGER)
        .error(
          `Paystack transaction ${reference} took ${transaction.amount} ${transaction.currency} for payment session ` +
            `${session.id}, which started ${started.amount} ${started.currency}: a bug or tampering. Refunding it in full.`
        )
    }

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
    return new StepResponse<RefundUnclaimedTransactionResult>({ refund: recorded as OrderRefundRecord, live_session_id: null })
  }
)

export const refundUnclaimedTransactionWorkflow = createWorkflow(
  "refund-unclaimed-transaction",
  (input: RefundUnclaimedTransactionInput) => {
    const key = transform({ input }, ({ input }) => `paystack-transaction:${input.reference}`)
    acquireLockStep({ key, timeout: 10, ttl: 60 })
    const result = refundUnclaimedTransactionStep(input)
    releaseLockStep({ key })
    return new WorkflowResponse(result)
  }
)
