import type { ProviderEventType, StaffActionType } from "@oja/domain"
import { acquireLockStep, emitEventStep, markOrderFulfillmentAsDeliveredWorkflow } from "@medusajs/medusa/core-flows"
import { transform, when, type WorkflowData } from "@medusajs/framework/workflows-sdk"
import { ORDER_DELIVERED, type FulfilmentRecord } from "../../lib/order-fulfilment"

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
  when("order-delivered", { fulfilment }, ({ fulfilment }) => fulfilment.state === "delivered").then(() => {
    const delivery = transform({ fulfilment }, ({ fulfilment }) => ({
      input: { orderId: fulfilment.order_id, fulfillmentId: fulfilment.shipment!.fulfillment_id },
    }))
    markOrderFulfillmentAsDeliveredWorkflow.runAsStep(delivery)
    const data = transform({ fulfilment }, ({ fulfilment }) => ({ id: fulfilment.order_id }))
    emitEventStep({ eventName: ORDER_DELIVERED, data }).config({ name: "emit-order-delivered" })
  })
}
