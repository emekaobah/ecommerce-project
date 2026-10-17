import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { paymentsOfOrder } from "../../../lib/order-fulfilment"
import { refundOrderShareStep, type RefundOrderShareInput } from "../steps/refund-order-share"

const findOrderPaymentsStep = createStep("find-order-payments", async (orderId: string, { container }) => {
  return new StepResponse((await paymentsOfOrder(container, orderId)).map((p) => p.id))
})

/** A refund of an order's share; of its items unless it says otherwise. */
export type RefundOrderShareWorkflowInput = Omit<RefundOrderShareInput, "covers"> & Partial<Pick<RefundOrderShareInput, "covers">>

/**
 * Refunds an order's share of what the buyer paid, never more (#20). Refunds touching the
 * same payment run one at a time, so each sees the refunds before it: the order's own, for
 * its share and what is left of its items and delivery fee, and other shops' orders', for the
 * provider's record of Paystack's reply.
 */
export const refundOrderShareWorkflow = createWorkflow("refund-order-share", (input: RefundOrderShareWorkflowInput) => {
  const paymentIds = findOrderPaymentsStep(input.order_id)
  const keys = transform({ input, paymentIds }, ({ input, paymentIds }) => [
    `order-refund:${input.order_id}`,
    ...paymentIds.map((id) => `payment-refund:${id}`),
  ])
  acquireLockStep({ key: keys, timeout: 10, ttl: 60 })
  const refunds = refundOrderShareStep(
    transform({ input }, ({ input }): RefundOrderShareInput => ({ ...input, covers: input.covers ?? "items" }))
  )
  releaseLockStep({ key: keys })
  return new WorkflowResponse(refunds)
})
