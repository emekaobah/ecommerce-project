import { emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { ORDER_PACKED, ORDER_READY_FOR_PICKUP } from "../../../lib/order-fulfilment"
import { checkPickedStep } from "../steps/check-picked"
import { transitionFulfilmentStep } from "../steps/transition-fulfilment"
import { lockOrderFulfilment, staffTrigger } from "../compose"

export type PackOrderInput = { order_id: string; /** The member who packed it. */ actor: string }

/**
 * Staff mark a fully picked order packed: a delivery order is Packed, ready for a courier label;
 * a pickup order is Ready for pickup, its code issued and its buyer told (#12).
 */
export const packOrderWorkflow = createWorkflow("pack-order", (input: PackOrderInput) => {
  const lock = lockOrderFulfilment(input)
  checkPickedStep({ order_id: input.order_id })
  const trigger = staffTrigger(input, "mark_packed")
  const fulfilment = transitionFulfilmentStep({ order_id: input.order_id, trigger })
  const eventName = transform({ fulfilment }, ({ fulfilment }) =>
    fulfilment.state === "ready_for_pickup" ? ORDER_READY_FOR_PICKUP : ORDER_PACKED
  )
  emitEventStep({ eventName, data: { id: input.order_id } })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
