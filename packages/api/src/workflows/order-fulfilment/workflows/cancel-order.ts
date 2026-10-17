import type { CancelAction, CancelRequest } from "@oja/domain"
import { emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { ORDER_CANCELLED } from "../../../lib/order-fulfilment"
import { cancelRefundOf } from "../../../lib/owed-refunds"
import { checkTransitionStep, transitionFulfilmentStep } from "../steps/transition-fulfilment"
import { cancelOrderGivingBackCodes, lockCodeCheckouts, lockOrderFulfilment } from "../compose"

export type CancelOrderInput = CancelRequest & {
  order_id: string
  /** Who cancels it: the shop's owners and managers (`staff`), or Oja's operators: the trigger's source. */
  source: CancelAction["source"]
  /** The member or admin user who cancelled it. */
  actor: string
}

/** What cancelling the order refunds its buyer (`cancelRefundOf`). */
const cancelRefundStep = createStep("cancelled-order-refund", async (orderId: string, { container }) => {
  return new StepResponse((await cancelRefundOf(container, orderId)).amount)
})

/**
 * An accepted order is cancelled (#17), by its shop's owners and managers or by Oja's
 * operators, with a reason: Accepted, Picking, Partially available, Packed (no courier label
 * booked) or Ready for pickup → Cancelled, and the order is cancelled in Medusa
 * (`cancelOrderGivingBackCodes`): its stock reservations released, and each promo code's use
 * given back once every order it discounted is cancelled. Returns the fulfilment and what
 * cancelling refunds its buyer (`cancelRefundOf`), which they are owed until refunded.
 *
 * Refunding it is separate (`cancelAndRefund`), as for a rejected order: a refund Paystack turns
 * down doesn't undo the cancellation, and is retried (#16). Not Medusa's `cancelOrderWorkflow`:
 * it refunds every payment linked to the order in full, which for an order sharing its payment
 * with other shops' orders is their money too, and isn't recorded as the order's refund.
 */
export const cancelAcceptedOrderWorkflow = createWorkflow("cancel-accepted-order", (input: CancelOrderInput) => {
  const lock = lockOrderFulfilment(input)
  const trigger = transform({ input }, ({ input }): CancelAction => ({
    source: input.source,
    type: "cancel",
    actor: input.actor,
    at: new Date().toISOString(),
    reason: input.reason,
    note: input.note,
  }))
  checkTransitionStep({ order_id: input.order_id, trigger })
  const checkoutLocks = lockCodeCheckouts(input)
  const refundAmount = cancelRefundStep(input.order_id)
  const fulfilment = transitionFulfilmentStep({ order_id: input.order_id, trigger })
  cancelOrderGivingBackCodes(input, checkoutLocks)

  const event = transform({ input, refundAmount }, ({ input, refundAmount }) => ({ id: input.order_id, amount: refundAmount }))
  emitEventStep({ eventName: ORDER_CANCELLED, data: event }).config({ name: "emit-order-cancelled" })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(
    transform({ fulfilment, refundAmount }, ({ fulfilment, refundAmount }) => ({ fulfilment, refund_amount: refundAmount }))
  )
})
