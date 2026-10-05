import { acquireLockStep, emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { ORDER_PACKED } from "../../../lib/order-fulfilment"
import { checkPickedStep } from "../steps/check-picked"
import { transitionFulfilmentStep } from "../steps/transition-fulfilment"

export type PackOrderInput = { order_id: string; /** The member who packed it. */ actor: string }

/** Staff mark a fully picked order packed: Picking → Packed, ready for a courier label. */
export const packOrderWorkflow = createWorkflow("pack-order", (input: PackOrderInput) => {
  const lock = transform({ input }, ({ input }) => `order-fulfilment:${input.order_id}`)
  acquireLockStep({ key: lock, timeout: 5, ttl: 30 })
  checkPickedStep({ order_id: input.order_id })
  const trigger = transform({ input }, ({ input }) => ({
    source: "staff" as const,
    type: "mark_packed" as const,
    actor: input.actor,
    at: new Date().toISOString(),
  }))
  const fulfilment = transitionFulfilmentStep({ order_id: input.order_id, trigger })
  emitEventStep({ eventName: ORDER_PACKED, data: { id: input.order_id } })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
