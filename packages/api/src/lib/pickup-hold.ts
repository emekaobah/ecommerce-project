import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { refundOrderShareWorkflow } from "../workflows/order-fulfilment/workflows/refund-order-share"
import { expirePickupHoldWorkflow } from "../workflows/order-fulfilment/workflows/expire-pickup-hold"
import { errorMessage } from "./errors"
import {
  asFulfilmentRecord,
  collectByOf,
  fulfilmentService,
  HOLD_LINE_FIELDS,
  holdLinesOf,
  NOT_COLLECTED_NOTE,
  sellersOfOrders,
  type OrderLineRow,
} from "./order-fulfilment"
import { shopHoursOf } from "./shop-hours"

// A pickup order nobody collects (#32, docs/design.md → Pickup): it is held for the shop's open
// days, then is Not collected. Its non-perishable lines are refunded and their stock returned;
// its perishable lines are the shop's, paid out less commission.

type Scope = Pick<MedusaContainer, "resolve">

/**
 * The hold-expiry job: every order Ready for pickup whose hold has ended by `now` is Not
 * collected, and its buyer refunded its non-perishable lines. A refund Paystack turns down is
 * logged, as for items removed while picking (#22).
 */
export async function expirePickupHolds(scope: Scope, now = new Date()) {
  const ready = (await fulfilmentService(scope).listOrderFulfilments({ state: "ready_for_pickup" })).map(asFulfilmentRecord)
  if (!ready.length) return
  const ids = ready.map((r) => r.order_id)
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const [sellers, { data }] = await Promise.all([
    sellersOfOrders(scope, ids),
    query.graph({ entity: "order", fields: ["id", ...HOLD_LINE_FIELDS], filters: { id: ids } }),
  ])
  const [hours, lines] = await Promise.all([
    shopHoursOf(scope, [...sellers.values()], now),
    holdLinesOf(scope, data as unknown as { id: string; items?: OrderLineRow[] | null }[]),
  ])
  const expired = ready.filter((row) => {
    const collectBy = collectByOf(row, hours.get(sellers.get(row.order_id) ?? "") ?? null, lines.get(row.order_id))
    return collectBy != null && Date.parse(collectBy.at) <= now.getTime()
  })
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  // One order at a time: each edits its order and calls Paystack.
  for (const row of expired) {
    try {
      await notCollectedAndRefund(scope, row.order_id)
    } catch (error) {
      // Collected meanwhile, most likely; the next run looks again.
      logger.warn(`Expiring the pickup hold of order ${row.order_id} failed: ${errorMessage(error)}`)
    }
  }
}

/** Moves the order to Not collected, then refunds what removing its non-perishable lines took off its total. */
async function notCollectedAndRefund(scope: Scope, orderId: string) {
  const { result } = await expirePickupHoldWorkflow(scope as MedusaContainer).run({ input: { order_id: orderId } })
  if (result.removed_amount <= 0) return
  try {
    await refundOrderShareWorkflow(scope as MedusaContainer).run({
      input: { order_id: orderId, amount: result.removed_amount, note: NOT_COLLECTED_NOTE },
    })
  } catch (error) {
    scope
      .resolve(ContainerRegistrationKeys.LOGGER)
      .error(`Refund of ${result.removed_amount} for order ${orderId}, not collected, failed: ${errorMessage(error)}`)
  }
}
