import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import {
  StepResponse,
  WorkflowResponse,
  createStep,
  createWorkflow,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { paymentsOfOrder } from "../../../lib/order-fulfilment"
import { refundOrderShareStep, type RefundOrderShareInput } from "../steps/refund-order-share"

const findOrderPaymentsStep = createStep("find-order-payments", async (orderId: string, { container }) => {
  return new StepResponse((await paymentsOfOrder(container, orderId)).map((p) => p.id))
})

/**
 * The locks a refund of the order holds: the order's refund lock, and each of its payments',
 * so refunds touching the same payment run one at a time.
 */
export function refundLockKeys(input: { order_id: string }) {
  const paymentIds = findOrderPaymentsStep(input.order_id)
  return transform({ input, paymentIds }, ({ input, paymentIds }) => [
    `order-refund:${input.order_id}`,
    ...paymentIds.map((id) => `payment-refund:${id}`),
  ])
}

/** A refund of an order's share; of its items unless it says otherwise. */
export type RefundOrderShareWorkflowInput = Omit<RefundOrderShareInput, "covers"> & Partial<Pick<RefundOrderShareInput, "covers">>

/**
 * Refunds an order's share of what the buyer paid, never more (#20). Refunds touching the
 * same payment run one at a time, so each sees the refunds before it: the order's own, for
 * its share and what is left of its items and delivery fee, and other shops' orders', for the
 * provider's record of Paystack's reply.
 */
export const refundOrderShareWorkflow = createWorkflow("refund-order-share", (input: RefundOrderShareWorkflowInput) => {
  const keys = refundLockKeys(input)
  acquireLockStep({ key: keys, timeout: 10, ttl: 60 })
  const refunds = refundOrderShareStep(
    transform({ input }, ({ input }): RefundOrderShareInput => ({ ...input, covers: input.covers ?? "items" }))
  )
  releaseLockStep({ key: keys })
  return new WorkflowResponse(refunds)
})
