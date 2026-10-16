import { confirmOrderEditRequestWorkflow } from "@mercurjs/core/workflows"
import {
  beginOrderEditOrderWorkflow,
  orderEditUpdateItemQuantityWorkflow,
  releaseLockStep,
  requestOrderEditRequestWorkflow,
} from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { NOT_COLLECTED_NOTE } from "../../../lib/order-fulfilment"
import { planHoldExpiryStep, removedAmountStep } from "../steps/expire-pickup-hold"
import { transitionFulfilmentStep } from "../steps/transition-fulfilment"
import { lockOrderFulfilment } from "../compose"

/** Edits are made by the system, not a member. */
const SYSTEM = "system"

/**
 * A pickup order's hold expired uncollected (#32): Ready for pickup → Not collected, which is
 * final. Its non-perishable lines come off through the same order edit as items removed while
 * picking (`removeUnavailableWorkflow`), so its total, the shop's commission and its stock
 * reservations follow and the stock is returned. Its perishable lines stay: not refunded, their
 * stock not returned, and the shop is paid for them (the order is payout-eligible only while
 * any remain).
 *
 * Refunding the buyer is separate (`refundOrderShareWorkflow`), as for items removed while
 * picking. The response carries what the edit took off the order's total, which is the refund.
 */
export const expirePickupHoldWorkflow = createWorkflow("expire-pickup-hold", (input: { order_id: string }) => {
  // Four order-edit workflows may run under the lock, so it is held longer than a plain transition's.
  const lock = lockOrderFulfilment(input, 120)
  const plan = planHoldExpiryStep({ order_id: input.order_id })

  when("non-perishable-lines", { plan }, ({ plan }) => plan.items.length > 0).then(() => {
    beginOrderEditOrderWorkflow.runAsStep({
      input: transform({ input }, ({ input }) => ({ order_id: input.order_id, created_by: SYSTEM, description: NOT_COLLECTED_NOTE })),
    })
    orderEditUpdateItemQuantityWorkflow.runAsStep({
      input: transform({ input, plan }, ({ input, plan }) => ({ order_id: input.order_id, items: plan.items })),
    })
    requestOrderEditRequestWorkflow.runAsStep({
      input: transform({ input }, ({ input }) => ({ order_id: input.order_id, requested_by: SYSTEM })),
    })
    confirmOrderEditRequestWorkflow.runAsStep({
      input: transform({ input }, ({ input }) => ({ order_id: input.order_id, confirmed_by: SYSTEM })),
    })
  })

  const trigger = transform({}, () => ({ source: "system" as const, type: "pickup_hold_expired" as const, at: new Date().toISOString() }))
  const fulfilment = transitionFulfilmentStep(
    transform({ input, plan, trigger }, ({ input, plan, trigger }) => ({
      order_id: input.order_id,
      trigger,
      payout_eligible: plan.perishable_kept,
    }))
  )
  const removedAmount = removedAmountStep(
    transform({ input, plan }, ({ input, plan }) => ({ order_id: input.order_id, total_before: plan.total_before }))
  )
  releaseLockStep({ key: lock })
  return new WorkflowResponse({ fulfilment, removed_amount: removedAmount })
})
