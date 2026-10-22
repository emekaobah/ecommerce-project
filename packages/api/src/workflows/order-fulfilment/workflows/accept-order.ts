import { emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { ORDER_ACCEPTED } from "../../../lib/order-fulfilment"
import { transitionFulfilmentStep } from "../steps/transition-fulfilment"
import { lockOrderFulfilment, staffTrigger } from "../compose"

export type AcceptOrderInput = { order_id: string; /** The member who accepted. */ actor: string }

/**
 * Staff accept a new order, which starts picking it straight away: New → Accepted → Picking.
 * Both steps are recorded, so the order's timeline and the buyer's push still say it was accepted.
 */
export const acceptOrderWorkflow = createWorkflow("accept-order", (input: AcceptOrderInput) => {
  const lock = lockOrderFulfilment(input)
  transitionFulfilmentStep({ order_id: input.order_id, trigger: staffTrigger(input, "accept") })
  const fulfilment = transitionFulfilmentStep({
    order_id: input.order_id,
    trigger: staffTrigger(input, "start_picking"),
  }).config({ name: "start-picking-order-fulfilment" })
  emitEventStep({ eventName: ORDER_ACCEPTED, data: { id: input.order_id } })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
