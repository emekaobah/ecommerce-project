import { emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { ORDER_ITEMS_REMOVED } from "../../../lib/order-fulfilment"
import { UNAVAILABLE_NOTE } from "../../../lib/order-picking"
import { planRemovalStep, recordRemovalStep } from "../steps/remove-unavailable"
import { editOrderLines, lockOrderFulfilment } from "../compose"

export type RemoveUnavailableInput = { order_id: string; /** The member who removed them. */ actor: string }

/**
 * Removes the units staff marked unavailable from the order (#22) with an order edit
 * (`editOrderLines`), so the order's total, its stock reservations and the shop's commission
 * follow. The order goes back from Partially available to Picking.
 *
 * Refunding the buyer is separate (`refundOrderEdit`), as for a rejected order: money that has
 * moved can't be undone, and a refund Paystack turns down shouldn't undo the edit. The
 * response carries what the edit took off the order's total, which is the refund. Once it
 * succeeds, `order_fulfilment.items_removed` tells the buyer (#5).
 */
export const removeUnavailableWorkflow = createWorkflow("remove-unavailable-order-items", (input: RemoveUnavailableInput) => {
  const lock = lockOrderFulfilment(input, 120)
  const plan = planRemovalStep({ order_id: input.order_id })
  const removedAmount = editOrderLines(
    transform({ input, plan }, ({ input, plan }) => ({
      order_id: input.order_id,
      items: plan.items,
      actor: input.actor,
      note: UNAVAILABLE_NOTE,
    }))
  )
  const fulfilment = recordRemovalStep(transform({ input }, ({ input }) => ({ order_id: input.order_id, actor: input.actor })))
  when("items-removed", { removedAmount }, ({ removedAmount }) => removedAmount > 0).then(() => {
    const data = transform({ input, plan, removedAmount }, ({ input, plan, removedAmount }) => ({
      id: input.order_id,
      amount: removedAmount,
      removed: plan.units,
      at: new Date().toISOString(),
    }))
    emitEventStep({ eventName: ORDER_ITEMS_REMOVED, data }).config({ name: "emit-items-removed" })
  })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(
    transform({ fulfilment, removedAmount }, ({ fulfilment, removedAmount }) => ({ fulfilment, removed_amount: removedAmount }))
  )
})
