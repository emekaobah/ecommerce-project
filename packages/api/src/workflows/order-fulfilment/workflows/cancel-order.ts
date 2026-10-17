import type { CancelAction, CancelReason } from "@oja/domain"
import {
  acquireLockStep,
  cancelOrdersStep,
  deleteReservationsByLineItemsStep,
  emitEventStep,
  releaseLockStep,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"
import { OrderWorkflowEvents } from "@medusajs/framework/utils"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { ORDER_CANCELLED } from "../../../lib/order-fulfilment"
import { shareLeftOf } from "../../../lib/order-refund"
import { checkoutOfOrderStep, giveBackCodeUsesStep } from "../steps/give-back-code-uses"
import { checkTransitionStep, transitionFulfilmentStep } from "../steps/transition-fulfilment"
import { lockOrderFulfilment } from "../compose"

export type CancelOrderInput = {
  order_id: string
  /** Who cancels it: the shop's owners and managers (`staff`), or Oja's operators. */
  source: CancelAction["source"]
  /** The member or admin user who cancelled it. */
  actor: string
  reason: CancelReason
  /** Required for `other`; shown to the buyer. */
  note?: string | null
}

/** All that is left of the order's share, which cancelling it refunds. */
const shareLeftStep = createStep("cancelled-order-share-left", async (orderId: string, { container }) => {
  return new StepResponse((await shareLeftOf(container, orderId)).amount)
})

/**
 * An accepted order is cancelled (#17), by its shop's owners and managers or by Oja's
 * operators, with a reason: Accepted, Picking, Partially available, Packed (no courier label
 * booked) or Ready for pickup → Cancelled. Its stock reservations are released, the order is
 * cancelled, and each promo code's use goes back once every order of the checkout it
 * discounted is cancelled. Returns the fulfilment and all that is left of the order's share,
 * which its buyer is owed until refunded.
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
    note: input.note ?? null,
  }))
  checkTransitionStep({ order_id: input.order_id, trigger })
  const checkout = checkoutOfOrderStep({ order_id: input.order_id })
  acquireLockStep({ key: checkout, timeout: 10, ttl: 30 }).config({ name: "acquire-checkout-lock" })
  const refundAmount = shareLeftStep(input.order_id)
  const fulfilment = transitionFulfilmentStep({ order_id: input.order_id, trigger })

  const { data: orders } = useQueryGraphStep({
    entity: "order",
    fields: ["id", "items.id"],
    filters: { id: input.order_id },
  })
  const lineItemIds = transform({ orders }, ({ orders }) => (orders[0]?.items ?? []).map((item: { id: string } | null) => item!.id))
  deleteReservationsByLineItemsStep(lineItemIds)
  cancelOrdersStep({ orderIds: [input.order_id] })
  giveBackCodeUsesStep({ order_id: input.order_id })
  releaseLockStep({ key: checkout }).config({ name: "release-checkout-lock" })

  const event = transform({ input, refundAmount }, ({ input, refundAmount }) => ({ id: input.order_id, amount: refundAmount }))
  emitEventStep({ eventName: OrderWorkflowEvents.CANCELED, data: { id: input.order_id } }).config({
    name: "emit-order-canceled",
  })
  emitEventStep({ eventName: ORDER_CANCELLED, data: event }).config({ name: "emit-order-cancelled" })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(
    transform({ fulfilment, refundAmount }, ({ fulfilment, refundAmount }) => ({ fulfilment, refund_amount: refundAmount }))
  )
})
