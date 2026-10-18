import type { HoldReminder } from "@oja/domain"
import { emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { ORDER_PICKUP_HOLD_REMINDER, asFulfilmentRecord, fulfilmentService } from "../../../lib/order-fulfilment"
import { lockOrderFulfilment } from "../compose"

export type RemindPickupHoldInput = { order_id: string; reminder: HoldReminder; /** ISO 8601: when the job found it due. */ at: string }

/**
 * Marks a pickup order reminded, unless it was already, or is no longer Ready for pickup (it was
 * collected). Says whether it marked it.
 */
const markHoldRemindedStep = createStep(
  "mark-pickup-hold-reminded",
  async ({ order_id, reminder }: RemindPickupHoldInput, { container }) => {
    const service = fulfilmentService(container)
    const [row] = (await service.listOrderFulfilments({ order_id })).map(asFulfilmentRecord)
    const sent = row?.hold_reminded ?? null
    if (row?.state !== "ready_for_pickup" || sent === "last_day" || sent === reminder) return new StepResponse(false, null)
    await service.updateOrderFulfilments({ id: row.id, hold_reminded: reminder })
    return new StepResponse(true, { id: row.id, sent })
  },
  async (marked: { id: string; sent: HoldReminder | null } | null | undefined, { container }) => {
    if (marked) await fulfilmentService(container).updateOrderFulfilments({ id: marked.id, hold_reminded: marked.sent })
  }
)

/** Reminds the buyer of a pickup order still to collect, once for each reminder (#33). */
export const remindPickupHoldWorkflow = createWorkflow("remind-pickup-hold", (input: RemindPickupHoldInput) => {
  const lock = lockOrderFulfilment(input)
  const marked = markHoldRemindedStep(input)
  when({ marked }, ({ marked }) => marked).then(() => {
    const data = transform({ input }, ({ input }) => ({ id: input.order_id, reminder: input.reminder, at: input.at }))
    emitEventStep({ eventName: ORDER_PICKUP_HOLD_REMINDER, data })
  })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(marked)
})
