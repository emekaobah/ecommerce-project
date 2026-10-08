import { confirmOrderEditRequestWorkflow } from "@mercurjs/core/workflows"
import {
  beginOrderEditOrderWorkflow,
  orderEditUpdateItemQuantityWorkflow,
  releaseLockStep,
  requestOrderEditRequestWorkflow,
} from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
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
 */
export const removeUnavailableWorkflow = createWorkflow("remove-unavailable-order-items", (input: RemoveUnavailableInput) => {
  const lock = lockOrderFulfilment(input)
  const plan = planRemovalStep({ order_id: input.order_id })

  beginOrderEditOrderWorkflow.runAsStep({
    input: transform({ input }, ({ input }) => ({
      order_id: input.order_id,
      created_by: input.actor,
      description: "Items unavailable at picking",
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
  releaseLockStep({ key: lock })
  return new WorkflowResponse(removal)
})
