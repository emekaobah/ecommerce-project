import { emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { ORDER_ACCEPTED } from "../../../lib/order-fulfilment"
import { transitionFulfilmentStep } from "../steps/transition-fulfilment"
import { lockOrderFulfilment, staffTrigger } from "../compose"

export type AcceptOrderInput = { order_id: string; /** The member who accepted. */ actor: string }

/** Staff accept a new order: New → Accepted. */
export const acceptOrderWorkflow = createWorkflow("accept-order", (input: AcceptOrderInput) => {
  const lock = lockOrderFulfilment(input)
  const trigger = staffTrigger(input, "accept")
  const fulfilment = transitionFulfilmentStep({ order_id: input.order_id, trigger })
  emitEventStep({ eventName: ORDER_ACCEPTED, data: { id: input.order_id } })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
