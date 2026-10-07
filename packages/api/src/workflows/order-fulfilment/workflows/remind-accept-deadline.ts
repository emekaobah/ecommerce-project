import { emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { ORDER_ACCEPT_DEADLINE_NEAR, asFulfilmentRecord, fulfilmentService } from "../../../lib/order-fulfilment"
import { lockOrderFulfilment } from "../compose"

export type RemindAcceptDeadlineInput = { order_id: string; /** ISO 8601: when the job found the deadline near. */ at: string }

/** Marks a new order reminded, unless it was already, or is no longer new. Says whether it marked it. */
const markRemindedStep = createStep(
  "mark-accept-reminded",
  async ({ order_id, at }: RemindAcceptDeadlineInput, { container }) => {
    const service = fulfilmentService(container)
    const [row] = (await service.listOrderFulfilments({ order_id })).map(asFulfilmentRecord)
    if (row?.state !== "new" || row.accept_reminded_at) return new StepResponse(false, null)
    await service.updateOrderFulfilments({ id: row.id, accept_reminded_at: new Date(at) })
    return new StepResponse(true, row.id)
  },
  async (id: string | null | undefined, { container }) => {
    if (id) await fulfilmentService(container).updateOrderFulfilments({ id, accept_reminded_at: null })
  }
)

/** Reminds the shop, once, that a new order nears its accept deadline unaccepted (#27). */
export const remindAcceptDeadlineWorkflow = createWorkflow("remind-accept-deadline", (input: RemindAcceptDeadlineInput) => {
  const lock = lockOrderFulfilment(input)
  const marked = markRemindedStep(input)
  when({ marked }, ({ marked }) => marked).then(() => {
    const data = transform({ input }, ({ input }) => ({ id: input.order_id, at: input.at }))
    emitEventStep({ eventName: ORDER_ACCEPT_DEADLINE_NEAR, data })
  })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(marked)
})
