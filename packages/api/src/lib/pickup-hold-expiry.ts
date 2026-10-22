import type { ShopHours } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { expirePickupHoldWorkflow } from "../workflows/order-fulfilment/workflows/expire-pickup-hold"
import { errorMessage } from "./errors"
import { refundOrderEdit } from "./order-edit-refund"
import { asFulfilmentRecord, fulfilmentService, sellersOfOrders, type FulfilmentRecord, type Picks } from "./order-fulfilment"
import { collectByOf, HOLD_LINE_FIELDS, holdLinesOf, NOT_COLLECTED_NOTE, type HoldLine, type OrderLineRow } from "./pickup-hold"
import { shopHoursOf } from "./shop-hours"

type Scope = Pick<MedusaContainer, "resolve">

/** A pickup order Ready for pickup, with its shop's hours and its lines still on it, which set its hold. */
export type HeldOrder = { row: FulfilmentRecord; hours: ShopHours | null; lines: HoldLine[] | undefined }

/** Every pickup order Ready for pickup, waiting at the counter (#32). */
export async function heldOrders(scope: Scope, now: Date): Promise<HeldOrder[]> {
  const ready = (await fulfilmentService(scope).listOrderFulfilments({ state: "ready_for_pickup" })).map(asFulfilmentRecord)
  if (!ready.length) return []
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
  return ready.map((row) => ({ row, hours: hours.get(sellers.get(row.order_id) ?? "") ?? null, lines: lines.get(row.order_id) }))
}

/**
 * The hold-expiry job (#32): every order Ready for pickup whose hold has ended by `now` is Not
 * collected, and its buyer refunded its non-perishable lines (`refundOrderEdit`).
 */
export async function expirePickupHolds(scope: Scope, now = new Date()) {
  const expired = (await heldOrders(scope, now)).flatMap(({ row, hours, lines }) => {
    const collectBy = collectByOf(row, hours, lines)
    return collectBy != null && Date.parse(collectBy.at) <= now.getTime() ? [row] : []
  })
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  // One order at a time: each edits its order and calls Paystack.
  for (const row of expired) {
    let edit: { removed_amount: number; refunded: Picks }
    try {
      edit = (await expirePickupHoldWorkflow(scope as MedusaContainer).run({ input: { order_id: row.order_id } })).result
    } catch (error) {
      // Collected meanwhile, most likely; the next run looks again.
      logger.warn(`Expiring the pickup hold of order ${row.order_id} failed: ${errorMessage(error)}`)
      continue
    }
    await refundOrderEdit(scope, {
      order_id: row.order_id,
      removed_amount: edit.removed_amount,
      lines: edit.refunded,
      note: NOT_COLLECTED_NOTE,
    })
  }
}
