import { releaseLockStep } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { StepResponse, WorkflowResponse, createStep, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { fulfilmentService, fulfilmentsOf } from "../../../lib/order-fulfilment"
import { lockOrderFulfilment } from "../compose"

const recordNewOrderStep = createStep(
  "record-new-order-fulfilment",
  async ({ order_id: orderId }: { order_id: string }, { container }) => {
    if ((await fulfilmentsOf(container, [orderId])).has(orderId)) return new StepResponse<string | null, string | null>(null, null)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({ entity: "order", fields: ["created_at"], filters: { id: orderId } })
    if (!data[0]) return new StepResponse<string | null, string | null>(null, null)
    const created = await fulfilmentService(container).createOrderFulfilments({
      order_id: orderId,
      state: "new",
      fulfilment: { state: "new" },
      placed_at: new Date(data[0].created_at as string | Date),
    })
    return new StepResponse<string | null, string | null>(created.id, created.id)
  },
  async (createdId: string | null | undefined, { container }) => {
    if (createdId) await fulfilmentService(container).deleteOrderFulfilments(createdId)
  }
)

/**
 * A placed order starts New, so the accept-deadline job can find it. Under the order's
 * fulfilment lock, like every transition: staff may act on the order before `order.placed`
 * arrives (it is sent only once Mercur's checkout workflow finishes), and a transition creates
 * the row itself then. Without the lock both could create it, and one would be refused.
 */
export const recordPlacedOrderWorkflow = createWorkflow("record-placed-order", (input: { order_id: string }) => {
  const lock = lockOrderFulfilment(input)
  const recorded = recordNewOrderStep(input)
  releaseLockStep({ key: lock })
  return new WorkflowResponse(recorded)
})
