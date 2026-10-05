import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { recordPickStep, type RecordPickInput } from "../steps/record-pick"

/** Staff tick a line off (or back on) while picking: sets how many of it are picked. */
export const recordPickWorkflow = createWorkflow("record-pick", (input: RecordPickInput) => {
  const lock = transform({ input }, ({ input }) => `order-fulfilment:${input.order_id}`)
  acquireLockStep({ key: lock, timeout: 5, ttl: 30 })
  const fulfilment = recordPickStep(input)
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
