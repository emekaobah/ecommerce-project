import { releaseLockStep } from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { recordPickStep, type RecordPickInput } from "../steps/record-pick"
import { lockOrderFulfilment } from "../compose"

/** Staff tick a line off (or back on) while picking: sets how many of it are picked. */
export const recordPickWorkflow = createWorkflow("record-pick", (input: RecordPickInput) => {
  const lock = lockOrderFulfilment(input)
  const fulfilment = recordPickStep(input)
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
