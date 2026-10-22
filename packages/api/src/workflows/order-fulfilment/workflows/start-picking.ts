import { releaseLockStep } from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { transitionFulfilmentStep } from "../steps/transition-fulfilment"
import { lockOrderFulfilment, staffTrigger } from "../compose"

export type StartPickingInput = { order_id: string; /** The member who started picking. */ actor: string }

/** Staff start picking an order accepted before accepting started picking (#70): Accepted → Picking. */
export const startPickingWorkflow = createWorkflow("start-picking-order", (input: StartPickingInput) => {
  const lock = lockOrderFulfilment(input)
  const trigger = staffTrigger(input, "start_picking")
  const fulfilment = transitionFulfilmentStep({ order_id: input.order_id, trigger })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
