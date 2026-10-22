import { releaseLockStep } from "@medusajs/medusa/core-flows"
import { StepResponse, WorkflowResponse, createStep, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { fundingToRecord } from "../../../lib/discount-funding"
import { fulfilmentService, fulfilmentsOf, newFulfilmentRow, placedOrdersOf } from "../../../lib/order-fulfilment"
import { lockOrderFulfilment } from "../compose"

const recordNewOrderStep = createStep(
  "record-new-order-fulfilment",
  async ({ order_id: orderId }: { order_id: string }, { container }) => {
    if ((await fulfilmentsOf(container, [orderId])).has(orderId)) return new StepResponse<string | null, string | null>(null, null)
    const placed = (await placedOrdersOf(container, [orderId])).get(orderId)
    if (!placed) return new StepResponse<string | null, string | null>(null, null)
    const created = await fulfilmentService(container).createOrderFulfilments(newFulfilmentRow(placed))
    return new StepResponse<string | null, string | null>(created.id, created.id)
  },
  async (createdId: string | null | undefined, { container }) => {
    if (createdId) await fulfilmentService(container).deleteOrderFulfilments(createdId)
  }
)

/** Who funds each promotion on the order (#6), as it stands when the order is placed; once. */
const recordDiscountFundingStep = createStep(
  "record-discount-funding",
  async ({ order_id: orderId }: { order_id: string }, { container }) => {
    const service = fulfilmentService(container)
    const [recorded] = await service.listDiscountFundings({ order_id: orderId }, { take: 1 })
    const funding = recorded ? [] : await fundingToRecord(container, orderId)
    if (!funding.length) return new StepResponse<void, string[]>(undefined, [])
    const created = await service.createDiscountFundings(funding.map((f) => ({ ...f, order_id: orderId })))
    return new StepResponse<void, string[]>(undefined, created.map((c) => c.id))
  },
  async (createdIds: string[] | undefined, { container }) => {
    if (createdIds?.length) await fulfilmentService(container).deleteDiscountFundings(createdIds)
  }
)

/**
 * A placed order starts New, so the accept-deadline job can find it, with the method it was
 * placed with fixed: delivered, or collected in store (#12); and with its buyer, shop and
 * checkout, so their orders are found through an index (#58). Under the order's fulfilment
 * lock, like every transition: staff may act on the order before `order.placed` arrives (it is
 * sent only once Mercur's checkout workflow finishes), and a transition creates the row itself
 * then. Without the lock both could create it, and one would be refused. Who funds each of its
 * discounts is recorded too, for its payout.
 */
export const recordPlacedOrderWorkflow = createWorkflow("record-placed-order", (input: { order_id: string }) => {
  const lock = lockOrderFulfilment(input)
  const recorded = recordNewOrderStep(input)
  recordDiscountFundingStep(input)
  releaseLockStep({ key: lock })
  return new WorkflowResponse(recorded)
})
