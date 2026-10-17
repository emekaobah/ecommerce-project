import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { StepResponse, WorkflowResponse, createStep, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { errorMessage } from "../../../lib/errors"
import { fulfilmentService, paymentsOfOrder, type OrderRefundRecord } from "../../../lib/order-fulfilment"
import { isDue, owedRefundsOf, PAYSTACK_MIN_REFUND, type OrderOwedRefund } from "../../../lib/owed-refunds"
import { PaystackRequestError, UNSETTLED_REFUND_STATUSES } from "../../../modules/paystack/client"
import { refundOrderShare } from "../steps/refund-order-share"
import { refundLockKeys } from "./refund-order-share"

export type RefundOwedInput = {
  order_id: string
  /** The member or operator that asked for it; none for the retry job. */
  created_by?: string
  note?: string
  /**
   * Set by the retry job, with when it runs (ISO 8601): the refund is tried only when due
   * (`isDue`), and not while another refund of the order is in progress.
   */
  retry_at?: string
}

/** The refunds made, and what the order still owes its buyer afterwards (null once nothing). */
export type RefundOwedResult = { refunds: OrderRefundRecord[]; owed: OrderOwedRefund | null }

const owedOf = async (container: Parameters<typeof owedRefundsOf>[0], orderId: string) =>
  (await owedRefundsOf(container, [orderId])).get(orderId) ?? null

/** Whether a refund of the order is still in Paystack's hands (`pending`, `processing` or `needs-attention`). */
async function refundInProgress(container: Parameters<typeof owedRefundsOf>[0], orderId: string) {
  const rows = await fulfilmentService(container).listOrderRefunds({ order_id: orderId, status: UNSETTLED_REFUND_STATUSES }, { take: 1 })
  return rows.length > 0
}

/**
 * Tries to refund what the order owes its buyer, as a refund of items. A refund Paystack
 * refuses is recorded as a failed order refund with Paystack's reason, an attempt (#16); the
 * order still owes the amount. Nothing is asked of Paystack under its ₦50 minimum.
 */
const refundOwedStep = createStep("refund-owed", async (input: RefundOwedInput, { container }) => {
  const owed = await owedOf(container, input.order_id)
  const unchanged = (): StepResponse<RefundOwedResult> => new StepResponse({ refunds: [], owed })
  if (!owed || owed.amount < PAYSTACK_MIN_REFUND) return unchanged()
  if (input.retry_at && (!isDue(owed, new Date(input.retry_at)) || (await refundInProgress(container, input.order_id)))) {
    return unchanged()
  }
  try {
    const refunds = await refundOrderShare(container, {
      order_id: input.order_id,
      covers: "items",
      amount: owed.amount,
      created_by: input.created_by,
      note: input.note,
    })
    return new StepResponse({ refunds, owed: await owedOf(container, input.order_id) })
  } catch (error) {
    const reason = error instanceof PaystackRequestError ? error.reason : errorMessage(error)
    container
      .resolve(ContainerRegistrationKeys.LOGGER)
      .error(`Refund of ${owed.amount} owed on order ${input.order_id} failed: ${errorMessage(error)}`)
    await recordRefusal(container, owed, reason)
    return new StepResponse({ refunds: [], owed: await owedOf(container, input.order_id) })
  }
})

/** Records a refund Paystack refused: a failed order refund of items with its reason, which no Medusa refund backs. */
async function recordRefusal(container: Parameters<typeof owedRefundsOf>[0], owed: OrderOwedRefund, reason: string) {
  const [payment] = await paymentsOfOrder(container, owed.order_id)
  await fulfilmentService(container).createOrderRefunds({
    order_id: owed.order_id,
    payment_id: payment?.id ?? null,
    amount: owed.amount,
    covers: "items",
    currency_code: owed.currency_code,
    transaction_reference: String(payment?.data?.reference ?? ""),
    status: "failed",
    failure_reason: reason,
  })
}

/**
 * Refunds what an order owes its buyer (#16), holding the order's refund lock: after an order
 * edit, by the retry job, or when an operator retries it. See `refundOwedStep`.
 */
export const refundOwedWorkflow = createWorkflow("refund-owed", (input: RefundOwedInput) => {
  const keys = refundLockKeys(input)
  acquireLockStep({ key: keys, timeout: 10, ttl: 60 })
  const result = refundOwedStep(input)
  releaseLockStep({ key: keys })
  return new WorkflowResponse(result)
})
