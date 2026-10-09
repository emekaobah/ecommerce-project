import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createPayoutAccountWorkflow } from "@mercurjs/core/workflows"
import { payOutOrderWorkflow } from "../workflows/payouts/pay-out-order"
import { errorMessage } from "./errors"
import { fulfilmentService, sellersOfOrders } from "./order-fulfilment"
import { owedBackBy, withUnsettledRefunds, type Scope } from "./payouts"

// The daily payout run (#29): every delivered order not yet paid out, to its shop.

/** Delivered orders not yet paid out and without an unsettled refund, by shop, oldest delivered first. */
async function ordersDueForPayout(scope: Scope): Promise<Map<string, string[]>> {
  const eligible = await fulfilmentService(scope).listOrderFulfilments(
    { payout_eligible_at: { $ne: null } },
    { select: ["order_id", "payout_eligible_at"], order: { payout_eligible_at: "ASC" } }
  )
  const ids = eligible.map((r) => r.order_id)
  if (!ids.length) return new Map()
  const [paidOut, waiting, sellers] = await Promise.all([
    fulfilmentService(scope).listShopPayouts({ order_id: ids }, { select: ["order_id"] }),
    withUnsettledRefunds(scope, ids),
    sellersOfOrders(scope, ids),
  ])
  const done = new Set(paidOut.map((p) => p.order_id))
  const due = new Map<string, string[]>()
  for (const id of ids.filter((id) => !done.has(id) && !waiting.has(id) && sellers.has(id))) {
    const seller = sellers.get(id)!
    due.set(seller, [...(due.get(seller) ?? []), id])
  }
  return due
}

/** The shop's payout account with Mercur, made now if it has none: onboarding is Oja's own (#26). */
async function ensurePayoutAccount(scope: Scope, sellerId: string) {
  const { data } = await scope
    .resolve(ContainerRegistrationKeys.QUERY)
    .graph({ entity: "seller", fields: ["payout_account.id"], filters: { id: sellerId } })
  if (data[0]?.payout_account) return
  await createPayoutAccountWorkflow(scope as MedusaContainer).run({ input: { seller_id: sellerId, data: {} } })
}

/**
 * Pays out every delivered order not yet paid out (#29), one Paystack transfer per order. A
 * shop's orders go one at a time, each taking out what the shop still owes back for refunds
 * after its earlier payouts. An order that can't be paid out now (Paystack refused the transfer,
 * the shop has no bank account) is tried again on the next run.
 */
export async function payOutDeliveredOrders(scope: MedusaContainer) {
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const paid: string[] = []
  // Shops are paid one after another: few are due each day, and Paystack is asked once per order.
  for (const [sellerId, orderIds] of await ordersDueForPayout(scope)) {
    try {
      await ensurePayoutAccount(scope, sellerId)
    } catch (error) {
      logger.warn(`Shop ${sellerId} has no payout account and couldn't be given one: ${errorMessage(error)}`)
      continue
    }
    let owed = await owedBackBy(scope, sellerId)
    for (const orderId of orderIds) {
      try {
        const { result } = await payOutOrderWorkflow(scope).run({ input: { order_id: orderId, owed_back: owed } })
        owed -= Number(result.recovered)
        paid.push(orderId)
      } catch (error) {
        logger.warn(`Paying out order ${orderId} failed: ${errorMessage(error)}`)
      }
    }
  }
  return paid
}
