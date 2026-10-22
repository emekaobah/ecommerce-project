import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createPayoutAccountWorkflow } from "@mercurjs/core/workflows"
import { payOutOrderWorkflow } from "../workflows/payouts/pay-out-order"
import { errorMessage } from "./errors"
import { fulfilmentService } from "./order-fulfilment"
import { nextPayoutAttempt, owedBackBy, payoutAttemptsOf, withUnsettledRefunds, type Scope } from "./payouts"

// The daily payout run (#29): every delivered order not yet paid out, to its shop.

/** Delivered orders not yet paid out and without an unsettled refund, by shop, oldest delivered first. */
async function ordersDueForPayout(scope: Scope): Promise<Map<string, string[]>> {
  const eligible = await fulfilmentService(scope).listOrderFulfilments(
    { payout_eligible_at: { $ne: null } },
    { select: ["order_id", "seller_id", "payout_eligible_at"], order: { payout_eligible_at: "ASC" } }
  )
  const ids = eligible.map((r) => r.order_id)
  if (!ids.length) return new Map()
  const sellers = new Map(eligible.flatMap((r) => (r.seller_id ? [[r.order_id, r.seller_id] as const] : [])))
  const [attempts, waiting] = await Promise.all([payoutAttemptsOf(scope, ids), withUnsettledRefunds(scope, ids)])
  // Paid out, on its way, or failed every attempt.
  const done = new Set(ids.filter((id) => nextPayoutAttempt((attempts.get(id) ?? []).map((a) => a.status)) === null))
  // An order cancelled after delivery is never paid out.
  const { data: cancelled } = await scope
    .resolve(ContainerRegistrationKeys.QUERY)
    .graph({ entity: "order", fields: ["id"], filters: { id: ids, status: "canceled" } })
  for (const { id } of cancelled) done.add(id)
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

/** Pays out a shop's due orders, oldest first; none when it can't be given a payout account. */
async function payOutShop(scope: MedusaContainer, sellerId: string, orderIds: string[]): Promise<string[]> {
  try {
    await ensurePayoutAccount(scope, sellerId)
  } catch (error) {
    scope
      .resolve(ContainerRegistrationKeys.LOGGER)
      .warn(`Shop ${sellerId} has no payout account and couldn't be given one: ${errorMessage(error)}`)
    return []
  }
  let owed = await owedBackBy(scope, sellerId)
  const paid: string[] = []
  // One order at a time: each takes out what the shop still owes back, less what the orders before it took.
  for (const orderId of orderIds) {
    try {
      const { result } = await payOutOrderWorkflow(scope).run({ input: { order_id: orderId, owed_back: owed } })
      owed -= Number(result.recovered)
      paid.push(orderId)
    } catch (error) {
      scope.resolve(ContainerRegistrationKeys.LOGGER).warn(`Paying out order ${orderId} failed: ${errorMessage(error)}`)
    }
  }
  return paid
}

/**
 * Pays out every delivered order not yet paid out (#29), one Paystack transfer per order. Shops
 * are paid at once, each shop's orders one at a time. An order that can't be paid out now
 * (Paystack refused the transfer, the shop has no bank account) is tried again on the next run.
 * Returns the orders paid out.
 */
export async function payOutDeliveredOrders(scope: MedusaContainer) {
  const due = [...(await ordersDueForPayout(scope))]
  const paid = await Promise.all(due.map(([sellerId, orderIds]) => payOutShop(scope, sellerId, orderIds)))
  return paid.flat()
}
