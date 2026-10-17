import type { ProviderEventType, StaffActionType } from "@oja/domain"
import { confirmOrderEditRequestWorkflow } from "@mercurjs/core/workflows"
import {
  acquireLockStep,
  beginOrderEditOrderWorkflow,
  cancelOrdersStep,
  deleteReservationsByLineItemsStep,
  emitEventStep,
  markOrderFulfillmentAsDeliveredWorkflow,
  orderEditUpdateItemQuantityWorkflow,
  releaseLockStep,
  requestOrderEditRequestWorkflow,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"
import { OrderWorkflowEvents } from "@medusajs/framework/utils"
import { transform, when, type WorkflowData } from "@medusajs/framework/workflows-sdk"
import { ORDER_DELIVERED, type FulfilmentRecord } from "../../lib/order-fulfilment"
import { orderTotalBeforeEditStep, removedByEditStep } from "./steps/edit-order-lines"
import { codeCheckoutLocksStep, giveBackCodeUsesStep } from "./steps/give-back-code-uses"

// Pieces the order-fulfilment workflows are composed from.

/**
 * Takes the order's fulfilment lock, so one change to an order's fulfilment runs at a time.
 * Returns its key, for `releaseLockStep` at the end of the workflow. `ttl` (seconds) is how
 * long the lock outlives a workflow that never releases it; a longer workflow needs more.
 */
export function lockOrderFulfilment(input: { order_id: string }, ttl = 30) {
  const key = transform({ input }, ({ input }) => `order-fulfilment:${input.order_id}`)
  acquireLockStep({ key, timeout: 5, ttl })
  return key
}

/**
 * Takes the locks of every checkout whose orders share a promo code with the order's
 * (`codeCheckoutLocksStep`), so two of them cancelled at once give a code's use back once.
 * Returns their keys, for `cancelOrderGivingBackCodes`.
 */
export function lockCodeCheckouts(input: { order_id: string }) {
  const keys = codeCheckoutLocksStep({ order_id: input.order_id })
  acquireLockStep({ key: keys, timeout: 30, ttl: 60 }).config({ name: "acquire-checkout-locks" })
  return keys
}

/**
 * Cancels the order in Medusa, rejected or cancelled (#17): its stock reservations are released,
 * the order is cancelled, and each promo code's use goes back once every order it discounted, of
 * the checkout and of a checkout sharing the code, is cancelled. Releases the checkout locks
 * (`lockCodeCheckouts`), then emits Medusa's `order.canceled`.
 */
export function cancelOrderGivingBackCodes(input: { order_id: string }, checkoutLocks: WorkflowData<string[]>) {
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
  emitEventStep({ eventName: OrderWorkflowEvents.CANCELED, data: { id: input.order_id } }).config({
    name: "emit-order-canceled",
  })
}

/** An order edit setting the order's lines to these quantities, made by `actor`: a member, or the system. */
export type OrderLinesEdit = { order_id: string; items: { id: string; quantity: number }[]; actor: string; note: string }

/**
 * Sets the order's lines to the edit's quantities through the same order edit Mercur's
 * `/vendor/order-edits` routes make (begin, set each line's quantity, request, confirm), so the
 * order's total, its stock reservations and the shop's commission follow (#22, #32). Returns
 * what the edit took off the order's total, which the buyer is owed until it is refunded
 * (`refundOrderEdit`). Four order-edit workflows run, so the caller's lock needs a long ttl.
 */
export function editOrderLines(edit: WorkflowData<OrderLinesEdit>) {
  const totalBefore = orderTotalBeforeEditStep(transform({ edit }, ({ edit }) => ({ order_id: edit.order_id })))
  beginOrderEditOrderWorkflow.runAsStep({
    input: transform({ edit }, ({ edit }) => ({ order_id: edit.order_id, created_by: edit.actor, description: edit.note })),
  })
  orderEditUpdateItemQuantityWorkflow.runAsStep({
    input: transform({ edit }, ({ edit }) => ({ order_id: edit.order_id, items: edit.items })),
  })
  requestOrderEditRequestWorkflow.runAsStep({
    input: transform({ edit }, ({ edit }) => ({ order_id: edit.order_id, requested_by: edit.actor })),
  })
  confirmOrderEditRequestWorkflow.runAsStep({
    input: transform({ edit }, ({ edit }) => ({ order_id: edit.order_id, confirmed_by: edit.actor })),
  })
  return removedByEditStep(
    transform({ edit, totalBefore }, ({ edit, totalBefore }) => ({ order_id: edit.order_id, total_before: totalBefore }))
  )
}

/** A shipment event the provider reported about the order, now: the one `typeOf` reads from the input. */
export function providerTrigger<I extends object, T extends ProviderEventType>(input: I, typeOf: (input: I) => T) {
  return transform({ input }, ({ input }) => ({
    source: "provider" as const,
    type: typeOf(input as I),
    at: new Date().toISOString(),
  }))
}

/** A staff action on the order, by the member in `input.actor`, now. */
export function staffTrigger<T extends StaffActionType>(input: { actor: string }, type: T) {
  return transform({ input }, ({ input }) => ({
    source: "staff" as const,
    type,
    actor: input.actor,
    at: new Date().toISOString(),
  }))
}

/**
 * Once a transition has delivered the order (#25): its courier fulfilment is marked delivered,
 * as Medusa and the web panels show it, and `order_fulfilment.delivered` is emitted. The
 * transition itself made it payout-eligible.
 */
export function whenDelivered(fulfilment: WorkflowData<FulfilmentRecord>) {
  // Only a booked shipment is delivered, so a delivered order always has one.
  const shipment = transform({ fulfilment }, ({ fulfilment }) =>
    fulfilment.state === "delivered" ? fulfilment.shipment : null
  )
  when("order-delivered", { shipment }, ({ shipment }) => !!shipment).then(() => {
    const delivery = transform({ fulfilment, shipment }, ({ fulfilment, shipment }) => ({
      input: { orderId: fulfilment.order_id, fulfillmentId: shipment?.fulfillment_id ?? "" },
    }))
    markOrderFulfillmentAsDeliveredWorkflow.runAsStep(delivery)
    const data = transform({ fulfilment }, ({ fulfilment }) => ({ id: fulfilment.order_id }))
    emitEventStep({ eventName: ORDER_DELIVERED, data }).config({ name: "emit-order-delivered" })
  })
}
