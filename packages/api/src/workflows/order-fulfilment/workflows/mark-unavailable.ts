import { releaseLockStep } from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { markUnavailableStep, type MarkUnavailableInput } from "../steps/mark-unavailable"
import { lockOrderFulfilment } from "../compose"

/**
 * Staff mark units of a line unavailable while picking (#22): Picking → Partially available,
 * until they are removed from the order (`removeUnavailableWorkflow`) or the marks cleared.
 */
export const markUnavailableWorkflow = createWorkflow("mark-order-items-unavailable", (input: MarkUnavailableInput) => {
  const lock = lockOrderFulfilment(input)
  const fulfilment = markUnavailableStep(input)
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
