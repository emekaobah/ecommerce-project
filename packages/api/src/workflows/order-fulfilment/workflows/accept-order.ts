import { acquireLockStep, emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { ORDER_ACCEPTED } from "../../../lib/order-fulfilment"
import { transitionFulfilmentStep } from "../steps/transition-fulfilment"

export type AcceptOrderInput = { order_id: string; /** The member who accepted. */ actor: string }

/** Staff accept a new order: New → Accepted. */
export const acceptOrderWorkflow = createWorkflow("accept-order", (input: AcceptOrderInput) => {
  const lock = transform({ input }, ({ input }) => `order-fulfilment:${input.order_id}`)
  acquireLockStep({ key: lock, timeout: 5, ttl: 30 })
  const trigger = transform({ input }, ({ input }) => ({
    source: "staff" as const,
    type: "accept" as const,
    actor: input.actor,
    at: new Date().toISOString(),
  }))
  const fulfilment = transitionFulfilmentStep({ order_id: input.order_id, trigger })
  emitEventStep({ eventName: ORDER_ACCEPTED, data: { id: input.order_id } })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
