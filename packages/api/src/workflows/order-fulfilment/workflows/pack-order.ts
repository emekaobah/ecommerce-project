import { emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { ORDER_PACKED } from "../../../lib/order-fulfilment"
import { checkPickedStep } from "../steps/check-picked"
import { transitionFulfilmentStep } from "../steps/transition-fulfilment"
import { lockOrderFulfilment, staffTrigger } from "../compose"

export type PackOrderInput = { order_id: string; /** The member who packed it. */ actor: string }

/**
 * Staff mark a fully picked order packed: a delivery order is Packed, ready for a courier label;
 * a pickup order is Ready for pickup, its code issued and its buyer pushed (#12).
 */
export const packOrderWorkflow = createWorkflow("pack-order", (input: PackOrderInput) => {
  const lock = lockOrderFulfilment(input)
  checkPickedStep({ order_id: input.order_id })
  const trigger = staffTrigger(input, "mark_packed")
  const fulfilment = transitionFulfilmentStep({ order_id: input.order_id, trigger })
  emitEventStep({ eventName: ORDER_PACKED, data: { id: input.order_id } })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
