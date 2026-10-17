import {
  acquireLockStep,
  cancelOrdersStep,
  deleteReservationsByLineItemsStep,
  emitEventStep,
  releaseLockStep,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"
import { OrderWorkflowEvents } from "@medusajs/framework/utils"
import { WorkflowResponse, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { ORDER_REJECTED } from "../../../lib/order-fulfilment"
import { codeCheckoutLocksStep, giveBackCodeUsesStep } from "../steps/give-back-code-uses"
import { transitionFulfilmentStep } from "../steps/transition-fulfilment"
import { lockOrderFulfilment } from "../compose"

export type RejectOrderInput = {
  order_id: string
  /** The member who rejected it; none when the accept deadline passed. */
  actor?: string
  reason: string
}

/**
 * A new order is rejected, by its shop or because the accept deadline passed: New → Rejected,
 * its stock reservations are released and the order is cancelled. A promo code's use goes back
 * once every order it discounted, of the checkout and of a checkout sharing the code, is
 * cancelled (#17). Refunding it is a separate
 * step (`refundOrderShareWorkflow`), so a refund Paystack turns down doesn't undo the rejection.
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
  const checkoutLocks = codeCheckoutLocksStep({ order_id: input.order_id })
  acquireLockStep({ key: checkoutLocks, timeout: 30, ttl: 60 }).config({ name: "acquire-checkout-locks" })
  const fulfilment = transitionFulfilmentStep({ order_id: input.order_id, trigger, reject_reason: input.reason })

  const { data: orders } = useQueryGraphStep({
    entity: "order",
    fields: ["id", "items.id"],
    filters: { id: input.order_id },
  })
  const lineItemIds = transform({ orders }, ({ orders }) => (orders[0]?.items ?? []).map((item: { id: string } | null) => item!.id))
  deleteReservationsByLineItemsStep(lineItemIds)
  cancelOrdersStep({ orderIds: [input.order_id] })
  giveBackCodeUsesStep({ order_id: input.order_id })
  releaseLockStep({ key: checkoutLocks }).config({ name: "release-checkout-locks" })

  const event = transform({ input }, ({ input }) => ({
    id: input.order_id,
    rejected_by: input.actor ? "seller" : "accept_deadline",
  }))
  emitEventStep({ eventName: OrderWorkflowEvents.CANCELED, data: { id: input.order_id } }).config({
    name: "emit-order-canceled",
  })
  emitEventStep({ eventName: ORDER_REJECTED, data: event }).config({ name: "emit-order-rejected" })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
