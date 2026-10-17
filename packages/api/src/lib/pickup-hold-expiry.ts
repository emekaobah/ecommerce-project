import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { expirePickupHoldWorkflow } from "../workflows/order-fulfilment/workflows/expire-pickup-hold"
import { errorMessage } from "./errors"
import { refundOrderEdit } from "./order-edit-refund"
import { asFulfilmentRecord, fulfilmentService, sellersOfOrders } from "./order-fulfilment"
import { collectByOf, HOLD_LINE_FIELDS, holdLinesOf, NOT_COLLECTED_NOTE, type OrderLineRow } from "./pickup-hold"
import { shopHoursOf } from "./shop-hours"

type Scope = Pick<MedusaContainer, "resolve">

/**
 * The hold-expiry job (#32): every order Ready for pickup whose hold has ended by `now` is Not
 * collected, and its buyer refunded its non-perishable lines (`refundOrderEdit`).
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
    let removedAmount: number
    try {
      const { result } = await expirePickupHoldWorkflow(scope as MedusaContainer).run({ input: { order_id: row.order_id } })
      removedAmount = result.removed_amount
    } catch (error) {
      // Collected meanwhile, most likely; the next run looks again.
      logger.warn(`Expiring the pickup hold of order ${row.order_id} failed: ${errorMessage(error)}`)
      continue
    }
    await refundOrderEdit(scope, { order_id: row.order_id, removed_amount: removedAmount, note: NOT_COLLECTED_NOTE })
  }
}
