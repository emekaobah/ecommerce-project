import { emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { handoverAlertDue, type HandoverDisagreement } from "@oja/domain"
import { ORDER_HANDOVER_DISAGREEMENT, alertedAt, asFulfilmentRecord, fulfilmentService } from "../../../lib/order-fulfilment"
import { lockOrderFulfilment } from "../compose"

export type AlertHandoverDisagreementInput = {
  order_id: string
  /** Whose half of the handover is missing. */
  waiting_for: HandoverDisagreement["waiting_for"]
  /** ISO 8601: when the job found the halves disagreeing. */
  at: string
}

/**
 * Marks the order alerted now, unless an alert isn't due (alerted within the day, or the halves
 * no longer disagree). Says whether it marked it.
 */
const markHandoverAlertedStep = createStep(
  "mark-handover-alerted",
  async ({ order_id, at }: AlertHandoverDisagreementInput, { container }) => {
    const service = fulfilmentService(container)
    const [row] = (await service.listOrderFulfilments({ order_id })).map(asFulfilmentRecord)
    if (!row || !handoverAlertDue(row.fulfilment, alertedAt(row), new Date(at))) return new StepResponse(false, null)
    await service.updateOrderFulfilments({ id: row.id, handover_alerted_at: new Date(at) })
    return new StepResponse(true, { id: row.id, previous: row.handover_alerted_at })
  },
  async (marked: { id: string; previous: Date | null } | null | undefined, { container }) => {
    if (marked) await fulfilmentService(container).updateOrderFulfilments({ id: marked.id, handover_alerted_at: marked.previous })
  }
)

/** Alerts the shop's owner that staff and the courier disagree about the order's handover (#25); again each day it lasts. */
export const alertHandoverDisagreementWorkflow = createWorkflow(
  "alert-handover-disagreement",
  (input: AlertHandoverDisagreementInput) => {
    const lock = lockOrderFulfilment(input)
    const marked = markHandoverAlertedStep(input)
    when({ marked }, ({ marked }) => marked).then(() => {
      const data = transform({ input }, ({ input }) => ({ id: input.order_id, waiting_for: input.waiting_for, at: input.at }))
      emitEventStep({ eventName: ORDER_HANDOVER_DISAGREEMENT, data })
    })
    releaseLockStep({ key: lock })
    return new WorkflowResponse(marked)
  }
)
