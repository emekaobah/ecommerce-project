import { acquireLockStep, cancelOrderWorkflow, emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { ORDER_REJECTED } from "../../../lib/order-fulfilment"
import { transitionFulfilmentStep } from "../steps/transition-fulfilment"

export type RejectOrderInput = {
  order_id: string
  /** The member who rejected it; none when the accept deadline passed. */
  actor?: string
  reason: string
}

/**
 * A new order is rejected, by its shop or because the accept deadline passed: New → Rejected,
 * and the order is cancelled, which returns its stock. Refunding it is a separate step
 * (`refundOrderShareWorkflow`), so a refund Paystack turns down doesn't undo the rejection.
 */
export const rejectOrderWorkflow = createWorkflow("reject-order", (input: RejectOrderInput) => {
  const lock = transform({ input }, ({ input }) => `order-fulfilment:${input.order_id}`)
  acquireLockStep({ key: lock, timeout: 5, ttl: 30 })
  const trigger = transform({ input }, ({ input }) => {
    const at = new Date().toISOString()
    return input.actor
      ? { source: "staff" as const, type: "reject" as const, actor: input.actor, at }
      : { source: "system" as const, type: "accept_deadline_passed" as const, at }
  })
  const fulfilment = transitionFulfilmentStep({ order_id: input.order_id, trigger, reject_reason: input.reason })
  cancelOrderWorkflow.runAsStep({ input: { order_id: input.order_id, canceled_by: input.actor } })
  const event = transform({ input }, ({ input }) => ({
    id: input.order_id,
    rejected_by: input.actor ? "seller" : "accept_deadline",
  }))
  emitEventStep({ eventName: ORDER_REJECTED, data: event })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
