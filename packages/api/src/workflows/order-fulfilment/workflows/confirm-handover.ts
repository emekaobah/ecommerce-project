import { releaseLockStep } from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { checkOrderLiveStep } from "../steps/check-order-live"
import { transitionFulfilmentStep } from "../steps/transition-fulfilment"
import { lockOrderFulfilment, staffTrigger, whenDelivered } from "../compose"

export type ConfirmHandoverInput = { order_id: string; /** The member who handed the parcel over. */ actor: string }

/**
 * Staff confirm they handed the parcel to the courier (#25), recorded with who and when. The
 * order is Handed to courier once Shipbubble has also reported the pickup; if the courier has
 * since reported it in transit or delivered, the order goes straight there. Refused for an
 * order cancelled meanwhile.
 */
export const confirmHandoverWorkflow = createWorkflow("confirm-order-handover", (input: ConfirmHandoverInput) => {
  const lock = lockOrderFulfilment(input)
  checkOrderLiveStep({ order_id: input.order_id })
  const trigger = staffTrigger(input, "confirm_handover")
  const fulfilment = transitionFulfilmentStep({ order_id: input.order_id, trigger })
  whenDelivered(fulfilment)
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
