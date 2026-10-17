import { emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { ORDER_NOT_COLLECTED } from "../../../lib/order-fulfilment"
import { NOT_COLLECTED_NOTE } from "../../../lib/pickup-hold"
import { planHoldExpiryStep } from "../steps/expire-pickup-hold"
import { transitionFulfilmentStep } from "../steps/transition-fulfilment"
import { editOrderLines, lockOrderFulfilment } from "../compose"

/** Who edits an order whose hold expired: the system, not a member. */
const SYSTEM_ACTOR = "system"

/**
 * A pickup order's hold expired uncollected (#32): Ready for pickup → Not collected, which is
 * final. Its non-perishable lines come off with an order edit (`editOrderLines`), as items
 * removed while picking do, so its total, the shop's commission and its stock reservations
 * follow and the stock is returned. Its perishable lines stay: not refunded, their stock not
 * returned, and the shop is paid for them (the order is payout-eligible only while any remain).
 *
 * Refunding the buyer is separate (`refundOrderEdit`), as for items removed while picking.
 * The response carries what the edit took off the order's total, which is the refund; so does
 * `order_fulfilment.not_collected`, which tells the buyer and the shop (#33).
 */
export const expirePickupHoldWorkflow = createWorkflow("expire-pickup-hold", (input: { order_id: string }) => {
  const lock = lockOrderFulfilment(input, 120)
  const plan = planHoldExpiryStep({ order_id: input.order_id })

  const edited = when("non-perishable-lines", { plan }, ({ plan }) => plan.items.length > 0).then(() =>
    editOrderLines(
      transform({ input, plan }, ({ input, plan }) => ({
        order_id: input.order_id,
        items: plan.items,
        actor: SYSTEM_ACTOR,
        note: NOT_COLLECTED_NOTE,
      }))
    )
  )

  const trigger = transform({}, () => ({ source: "system" as const, type: "pickup_hold_expired" as const, at: new Date().toISOString() }))
  const fulfilment = transitionFulfilmentStep(
    transform({ input, plan, trigger }, ({ input, plan, trigger }) => ({
      order_id: input.order_id,
      trigger,
      payout_eligible: plan.perishable_kept,
    }))
  )
  const event = transform({ input, plan, edited }, ({ input, plan, edited }) => ({
    id: input.order_id,
    amount: edited ?? 0,
    refunded: plan.refunded,
    kept: plan.kept,
  }))
  emitEventStep({ eventName: ORDER_NOT_COLLECTED, data: event }).config({ name: "emit-not-collected" })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(
    transform({ fulfilment, edited }, ({ fulfilment, edited }) => ({ fulfilment, removed_amount: edited ?? 0 }))
  )
})
