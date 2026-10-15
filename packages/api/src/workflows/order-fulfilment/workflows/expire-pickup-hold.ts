import { confirmOrderEditRequestWorkflow } from "@mercurjs/core/workflows"
import {
  beginOrderEditOrderWorkflow,
  emitEventStep,
  orderEditUpdateItemQuantityWorkflow,
  releaseLockStep,
  requestOrderEditRequestWorkflow,
} from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { NOT_COLLECTED_NOTE, ORDER_NOT_COLLECTED } from "../../../lib/order-fulfilment"
import { holdRemovalAmountStep, planHoldExpiryStep } from "../steps/expire-pickup-hold"
import { transitionFulfilmentStep } from "../steps/transition-fulfilment"
import { lockOrderFulfilment } from "../compose"

export type ExpirePickupHoldInput = { order_id: string }

/**
 * A pickup order nobody collected in time (#32): Ready for pickup → Not collected, which is
 * final, so its code stops working. Its non-perishable lines are removed through the same order
 * edit as unavailable items (`removeUnavailableWorkflow`), so the order's total, its stock
 * reservations and the shop's commission follow and their stock is returned. Perishable lines
 * stay on the order, reserved, so their stock isn't returned; while paid ones remain the order
 * may be paid out to the shop for them.
 *
 * Refunding the buyer what the edit took off is a separate workflow (`refundOrderShareWorkflow`),
 * as for unavailable items. The response carries that amount.
 */
export const expirePickupHoldWorkflow = createWorkflow("expire-pickup-hold", (input: ExpirePickupHoldInput) => {
  // Four order-edit workflows run under the lock, so it is held longer than a plain transition's.
  const lock = lockOrderFulfilment(input, 120)
  const plan = planHoldExpiryStep({ order_id: input.order_id })
  const trigger = transform({}, () => ({ source: "system" as const, type: "pickup_hold_expired" as const, at: new Date().toISOString() }))
  const fulfilment = transitionFulfilmentStep(
    transform({ input, trigger, plan }, ({ input, trigger, plan }) => ({
      order_id: input.order_id,
      trigger,
      payout_eligible: plan.perishable_left,
    }))
  )

  const removedAmount = when("non-perishables-to-remove", { plan }, ({ plan }) => plan.items.length > 0).then(() => {
    beginOrderEditOrderWorkflow.runAsStep({
      input: transform({ input }, ({ input }) => ({ order_id: input.order_id, description: NOT_COLLECTED_NOTE })),
    })
    orderEditUpdateItemQuantityWorkflow.runAsStep({
      input: transform({ input, plan }, ({ input, plan }) => ({ order_id: input.order_id, items: plan.items })),
    })
    requestOrderEditRequestWorkflow.runAsStep({ input: { order_id: input.order_id } })
    confirmOrderEditRequestWorkflow.runAsStep({ input: { order_id: input.order_id } })
    return holdRemovalAmountStep(transform({ input, plan }, ({ input, plan }) => ({ order_id: input.order_id, total_before: plan.total_before })))
  })

  const result = transform({ fulfilment, removedAmount }, ({ fulfilment, removedAmount }) => ({
    fulfilment,
    removed_amount: removedAmount ?? 0,
  }))
  emitEventStep({
    eventName: ORDER_NOT_COLLECTED,
    data: transform({ input, result }, ({ input, result }) => ({ id: input.order_id, amount: result.removed_amount })),
  })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(result)
})
