import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { transitionFulfilmentStep } from "../steps/transition-fulfilment"

export type StartPickingInput = { order_id: string; /** The member who started picking. */ actor: string }

/** Staff start picking an accepted order: Accepted → Picking. */
export const startPickingWorkflow = createWorkflow("start-picking-order", (input: StartPickingInput) => {
  const lock = transform({ input }, ({ input }) => `order-fulfilment:${input.order_id}`)
  acquireLockStep({ key: lock, timeout: 5, ttl: 30 })
  const trigger = transform({ input }, ({ input }) => ({
    source: "staff" as const,
    type: "start_picking" as const,
    actor: input.actor,
    at: new Date().toISOString(),
  }))
  const fulfilment = transitionFulfilmentStep({ order_id: input.order_id, trigger })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
