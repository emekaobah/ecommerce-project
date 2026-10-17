import { emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { ORDER_REJECTED } from "../../../lib/order-fulfilment"
import { transitionFulfilmentStep } from "../steps/transition-fulfilment"
import { cancelOrderGivingBackCodes, lockCodeCheckouts, lockOrderFulfilment } from "../compose"

export type RejectOrderInput = {
  order_id: string
  /** The member who rejected it; none when the accept deadline passed. */
  actor?: string
  reason: string
}

/**
 * A new order is rejected, by its shop or because the accept deadline passed: New → Rejected,
 * and the order is cancelled in Medusa (`cancelOrderGivingBackCodes`): its stock reservations
 * released, and a promo code's use given back once every order it discounted is cancelled (#17).
 * Refunding it is a separate step (`refundOrderShareWorkflow`), so a refund Paystack turns down
 * doesn't undo the rejection.
 *
 * Not Medusa's `cancelOrderWorkflow`: it refunds every payment linked to the order in full,
 * which for an order sharing its payment with other shops' orders is their money too, and
 * isn't recorded as the order's refund.
 */
export const rejectOrderWorkflow = createWorkflow("reject-order", (input: RejectOrderInput) => {
  const lock = lockOrderFulfilment(input)
  const trigger = transform({ input }, ({ input }) => {
    const at = new Date().toISOString()
    return input.actor
      ? { source: "staff" as const, type: "reject" as const, actor: input.actor, at }
      : { source: "system" as const, type: "accept_deadline_passed" as const, at }
  })
  const checkoutLocks = lockCodeCheckouts(input)
  const fulfilment = transitionFulfilmentStep({ order_id: input.order_id, trigger, reject_reason: input.reason })
  cancelOrderGivingBackCodes(input, checkoutLocks)

  const event = transform({ input }, ({ input }) => ({
    id: input.order_id,
    rejected_by: input.actor ? "seller" : "accept_deadline",
  }))
  emitEventStep({ eventName: ORDER_REJECTED, data: event }).config({ name: "emit-order-rejected" })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
