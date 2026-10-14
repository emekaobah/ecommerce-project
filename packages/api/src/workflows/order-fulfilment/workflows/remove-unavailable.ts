import { confirmOrderEditRequestWorkflow } from "@mercurjs/core/workflows"
import {
  beginOrderEditOrderWorkflow,
  emitEventStep,
  orderEditUpdateItemQuantityWorkflow,
  releaseLockStep,
  requestOrderEditRequestWorkflow,
} from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { ORDER_ITEMS_REMOVED } from "../../../lib/order-fulfilment"
import { UNAVAILABLE_NOTE } from "../../../lib/order-picking"
import { planRemovalStep, recordRemovalStep } from "../steps/remove-unavailable"
import { lockOrderFulfilment } from "../compose"

export type RemoveUnavailableInput = { order_id: string; /** The member who removed them. */ actor: string }

/**
 * Removes the units staff marked unavailable from the order (#22), through the same order edit
 * Mercur's `/vendor/order-edits` routes make (begin, set each line's quantity, request,
 * confirm), so the order's total, its stock reservations and the shop's commission follow.
 * The order goes back from Partially available to Picking.
 *
 * Refunding the buyer is a separate workflow (`refundOrderShareWorkflow`), as for a rejected
 * order: money that has moved can't be undone, and a refund Paystack turns down shouldn't undo
 * the edit. The response carries what the edit took off the order's total, which is the refund.
 * Once it succeeds, `order_fulfilment.items_removed` tells the buyer (#5).
 */
export const removeUnavailableWorkflow = createWorkflow("remove-unavailable-order-items", (input: RemoveUnavailableInput) => {
  // Four order-edit workflows run under the lock, so it is held longer than a plain transition's.
  const lock = lockOrderFulfilment(input, 120)
  const plan = planRemovalStep({ order_id: input.order_id })

  beginOrderEditOrderWorkflow.runAsStep({
    input: transform({ input }, ({ input }) => ({
      order_id: input.order_id,
      created_by: input.actor,
      description: UNAVAILABLE_NOTE,
    })),
  })
  orderEditUpdateItemQuantityWorkflow.runAsStep({
    input: transform({ input, plan }, ({ input, plan }) => ({ order_id: input.order_id, items: plan.items })),
  })
  requestOrderEditRequestWorkflow.runAsStep({
    input: transform({ input }, ({ input }) => ({ order_id: input.order_id, requested_by: input.actor })),
  })
  confirmOrderEditRequestWorkflow.runAsStep({
    input: transform({ input }, ({ input }) => ({ order_id: input.order_id, confirmed_by: input.actor })),
  })

  const removal = recordRemovalStep(
    transform({ input, plan }, ({ input, plan }) => ({
      order_id: input.order_id,
      actor: input.actor,
      total_before: plan.total_before,
    }))
  )
  when("items-removed", { removal }, ({ removal }) => removal.removed_amount > 0).then(() => {
    const data = transform({ input, plan, removal }, ({ input, plan, removal }) => ({
      id: input.order_id,
      amount: removal.removed_amount,
      removed: plan.units,
      at: new Date().toISOString(),
    }))
    emitEventStep({ eventName: ORDER_ITEMS_REMOVED, data }).config({ name: "emit-items-removed" })
  })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(removal)
})
