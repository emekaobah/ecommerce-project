import { emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { handoverDisagreement } from "@oja/domain"
import { ORDER_HANDOVER_DISAGREEMENT, asFulfilmentRecord, fulfilmentService } from "../../../lib/order-fulfilment"
import { lockOrderFulfilment } from "../compose"

export type AlertHandoverDisagreementInput = {
  order_id: string
  /** Whose half of the handover is missing. */
  waiting_for: "staff" | "courier"
  /** ISO 8601: when the job found the halves disagreeing. */
  at: string
}

/** Marks the order alerted, unless it was already or its halves no longer disagree. Says whether it marked it. */
const markHandoverAlertedStep = createStep(
  "mark-handover-alerted",
  async ({ order_id, at }: AlertHandoverDisagreementInput, { container }) => {
    const service = fulfilmentService(container)
    const [row] = (await service.listOrderFulfilments({ order_id })).map(asFulfilmentRecord)
    if (!row || row.handover_alerted_at || !handoverDisagreement(row.fulfilment, new Date(at))) {
      return new StepResponse(false, null)
    }
    await service.updateOrderFulfilments({ id: row.id, handover_alerted_at: new Date(at) })
    return new StepResponse(true, row.id)
  },
  async (id: string | null | undefined, { container }) => {
    if (id) await fulfilmentService(container).updateOrderFulfilments({ id, handover_alerted_at: null })
  }
)

/** Alerts the shop's owner, once, that staff and the courier disagree about the order's handover (#25). */
export const alertHandoverDisagreementWorkflow = createWorkflow(
  "alert-handover-disagreement",
  (input: AlertHandoverDisagreementInput) => {
    const lock = lockOrderFulfilment(input)
    const marked = markHandoverAlertedStep(input)
    when({ marked }, ({ marked }) => marked).then(() => {
      const data = transform({ input }, ({ input }) => ({ id: input.order_id, waiting_for: input.waiting_for }))
      emitEventStep({ eventName: ORDER_HANDOVER_DISAGREEMENT, data })
    })
    releaseLockStep({ key: lock })
    return new WorkflowResponse(marked)
  }
)
