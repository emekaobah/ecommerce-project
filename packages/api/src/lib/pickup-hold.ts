import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MathBN } from "@medusajs/framework/utils"
import { expirePickupHoldWorkflow } from "../workflows/order-fulfilment/workflows/expire-pickup-hold"
import { refundOrderShareWorkflow } from "../workflows/order-fulfilment/workflows/refund-order-share"
import { errorMessage } from "./errors"
import { hoursOfOrders } from "./order-acceptance"
import { asFulfilmentRecord, collectByOf, fulfilmentService, NOT_COLLECTED_NOTE } from "./order-fulfilment"
import { perishableLinesOf } from "./perishable"

// The pickup hold (#32, docs/design.md → Pickup): a pickup order nobody collects within its hold
// is Not collected. Its non-perishable lines are refunded and their stock returned; its
// perishable lines are paid out to the shop.

type Scope = Pick<MedusaContainer, "resolve">

/** How long after an order was Not collected a refund that didn't go through is tried again. */
const REFUND_RETRY_MS = 7 * 24 * 60 * 60 * 1000

/** Refunds the buyer an amount owed on a Not collected order; a refund that fails is logged and left for the job. */
async function refundNotCollected(scope: Scope, orderId: string, amount: number) {
  try {
    await refundOrderShareWorkflow(scope as MedusaContainer).run({ input: { order_id: orderId, amount, note: NOT_COLLECTED_NOTE } })
  } catch (error) {
    scope.resolve(ContainerRegistrationKeys.LOGGER).error(`Refund of ${amount} for uncollected order ${orderId} failed: ${errorMessage(error)}`)
  }
}

/**
 * The pickup-hold job: every order Ready for pickup past its collect-by time is Not collected
 * and refunded what removing its non-perishable lines took off it. Recently Not collected orders
 * whose refund didn't go through (the order still owes the buyer) are refunded again.
 */
export async function expireUncollectedOrders(scope: Scope, now = new Date()) {
  const service = fulfilmentService(scope)
  const ready = (await service.listOrderFulfilments({ state: "ready_for_pickup" })).map(asFulfilmentRecord)
  const [hoursOf, lines] = await Promise.all([
    hoursOfOrders(scope, ready, now),
    perishableLinesOf(scope, ready.map((r) => r.order_id)),
  ])
  const expired = ready.filter((row) => {
    // No collect-by time while the shop is paused with no time set to reopen: its clock is stopped.
    const by = collectByOf(row, hoursOf(row), lines.get(row.order_id) ?? [])
    return by != null && Date.parse(by) <= now.getTime()
  })
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  // One order at a time: each locks its order and payments, and calls Paystack.
  for (const row of expired) {
    try {
      const { result } = await expirePickupHoldWorkflow(scope as MedusaContainer).run({ input: { order_id: row.order_id } })
      if (result.removed_amount > 0) await refundNotCollected(scope, row.order_id, result.removed_amount)
    } catch (error) {
      // Collected meanwhile, most likely; the next run looks again.
      logger.warn(`Expiring the pickup hold of order ${row.order_id} failed: ${errorMessage(error)}`)
    }
  }

  const notCollected = await service.listOrderFulfilments({
    state: "not_collected",
    updated_at: { $gte: new Date(now.getTime() - REFUND_RETRY_MS) },
  })
  for (const row of notCollected) {
    const owed = await owedToBuyer(scope, row.order_id)
    if (owed > 0) await refundNotCollected(scope, row.order_id, owed)
  }
}

/** What the order still owes its buyer once its edit took lines off it: a negative pending difference. */
async function owedToBuyer(scope: Scope, orderId: string): Promise<number> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order", fields: ["id", "summary"], filters: { id: orderId } })
  const pending = (data[0]?.summary as { pending_difference?: number } | undefined)?.pending_difference ?? 0
  return MathBN.convert(MathBN.max(MathBN.mult(pending, -1), 0)).toNumber()
}
