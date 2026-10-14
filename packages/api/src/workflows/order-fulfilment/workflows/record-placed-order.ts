import { newFulfilment } from "@oja/domain"
import { releaseLockStep } from "@medusajs/medusa/core-flows"
import { StepResponse, WorkflowResponse, createStep, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { fulfilmentService, fulfilmentsOf, placedOrderOf } from "../../../lib/order-fulfilment"
import { lockOrderFulfilment } from "../compose"

const recordNewOrderStep = createStep(
  "record-new-order-fulfilment",
  async ({ order_id: orderId }: { order_id: string }, { container }) => {
    if ((await fulfilmentsOf(container, [orderId])).has(orderId)) return new StepResponse<string | null, string | null>(null, null)
    const placed = await placedOrderOf(container, orderId)
    if (!placed) return new StepResponse<string | null, string | null>(null, null)
    const created = await fulfilmentService(container).createOrderFulfilments({
      order_id: orderId,
      state: "new",
      fulfilment: newFulfilment(placed.method),
      placed_at: placed.placed_at,
    })
    return new StepResponse<string | null, string | null>(created.id, created.id)
  },
  async (createdId: string | null | undefined, { container }) => {
    if (createdId) await fulfilmentService(container).deleteOrderFulfilments(createdId)
  }
)

/**
 * A placed order starts New, so the accept-deadline job can find it, with the method it was
 * placed with fixed: delivered, or collected in store (#12). Under the order's fulfilment
 * lock, like every transition: staff may act on the order before `order.placed` arrives (it is
 * sent only once Mercur's checkout workflow finishes), and a transition creates the row itself
 * then. Without the lock both could create it, and one would be refused.
 */
export const recordPlacedOrderWorkflow = createWorkflow("record-placed-order", (input: { order_id: string }) => {
  const lock = lockOrderFulfilment(input)
  const recorded = recordNewOrderStep(input)
  releaseLockStep({ key: lock })
  return new WorkflowResponse(recorded)
})
