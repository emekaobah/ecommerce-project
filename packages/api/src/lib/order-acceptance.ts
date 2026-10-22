import { acceptDeadline, acceptReminderDue } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { refundOrderShareWorkflow } from "../workflows/order-fulfilment/workflows/refund-order-share"
import { rejectOrderWorkflow } from "../workflows/order-fulfilment/workflows/reject-order"
import { remindAcceptDeadlineWorkflow } from "../workflows/order-fulfilment/workflows/remind-accept-deadline"
import { errorMessage } from "./errors"
import { asFulfilmentRecord, fulfilmentService, orderMoney, paymentsOfOrder, sellersOfOrders, type FulfilmentRecord } from "./order-fulfilment"
import { unitsOnOrder } from "./order-picking"
import { refundPlan } from "./order-refund"
import { shopHoursOf } from "./shop-hours"
import { refundUnplacedPayment } from "./unplaced-checkout"

// Staff accept or reject a new order; one not accepted by its deadline is rejected for them.
// A rejected order is refunded its share of the checkout's payment (#20).

type Scope = Pick<MedusaContainer, "resolve">

/** The reason given for an order the accept deadline rejected. */
export const DEADLINE_REASON = "Not accepted in time"

/** How long after rejecting an order a refund that didn't go through is tried again. */
const REFUND_RETRY_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Rejects a new order and refunds it. A refund Paystack turns down (e.g. "Insufficient
 * balance") leaves the order rejected and unrefunded: the accept-deadline job tries again.
 */
export async function rejectAndRefund(scope: Scope, input: { order_id: string; actor?: string; reason: string }) {
  const { result: fulfilment } = await rejectOrderWorkflow(scope as MedusaContainer).run({ input })
  await refundRejected(scope, input.order_id, input.actor, input.reason)
  return fulfilment
}

/** Refunds a rejected order; a refund that fails is logged and left for the job. Says whether it went through. */
async function refundRejected(scope: Scope, orderId: string, actor: string | undefined, reason: string) {
  try {
    await refundOrderShareWorkflow(scope as MedusaContainer).run({
      // Nobody is paid for a rejected order: all of its share is refunded, delivery fee and all,
      // for every line on it (#61).
      input: {
        order_id: orderId,
        covers: "all",
        lines: await unitsOnOrder(scope, orderId),
        created_by: actor,
        note: `Order rejected: ${reason}`,
      },
    })
    return true
  } catch (error) {
    scope.resolve(ContainerRegistrationKeys.LOGGER).error(`Refund of rejected order ${orderId} failed: ${errorMessage(error)}`)
    return false
  }
}

/** Each waiting order's shop's hours, which its accept deadline counts in (ADR 0004); null for a shop without them. */
async function hoursOfOrders(scope: Scope, rows: FulfilmentRecord[], now: Date) {
  const sellers = await sellersOfOrders(scope, rows.map((r) => r.order_id))
  const hours = await shopHoursOf(scope, [...sellers.values()], now)
  return (row: FulfilmentRecord) => hours.get(sellers.get(row.order_id) ?? "") ?? null
}

/**
 * The accept-deadline job: rejects and refunds every new order past its deadline (24 of its
 * shop's open hours), and tries
 * again to refund recently rejected orders whose refund didn't go through.
 */
export async function rejectOverdueOrders(scope: Scope, now = new Date()) {
  const service = fulfilmentService(scope)
  const waiting = (await service.listOrderFulfilments({ state: "new" })).map(asFulfilmentRecord)
  const hoursOf = await hoursOfOrders(scope, waiting, now)
  const overdue = waiting.filter((row) => {
    // No deadline only when the shop doesn't reopen to finish the clock.
    const deadline = acceptDeadline(new Date(row.placed_at).toISOString(), hoursOf(row))
    return deadline != null && Date.parse(deadline) <= now.getTime()
  })
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  // One order at a time: each locks its order and payments, and calls Paystack.
  for (const row of overdue) {
    try {
      await rejectAndRefund(scope, { order_id: row.order_id, reason: DEADLINE_REASON })
    } catch (error) {
      // Accepted or rejected meanwhile, most likely; the next run looks again.
      logger.warn(`Rejecting overdue order ${row.order_id} failed: ${errorMessage(error)}`)
    }
  }

  const rejected = await service.listOrderFulfilments({
    state: "rejected",
    updated_at: { $gte: new Date(now.getTime() - REFUND_RETRY_MS) },
  })
  for (const row of rejected) {
    if (!(await isRefundDue(scope, row.order_id))) continue
    if (await refundRejected(scope, row.order_id, undefined, row.reject_reason ?? DEADLINE_REASON)) continue
    const lastTry = new Date(new Date(row.updated_at).getTime() + REFUND_RETRY_MS).toISOString()
    logger.error(`Rejected order ${row.order_id} is still unrefunded; retries stop at ${lastTry}, after which it must be refunded by hand`)
  }
}

/**
 * The accept-deadline job's reminder: each new order whose deadline is near, and whose shop
 * hasn't been reminded of it yet, is reminded once (#27).
 */
export async function remindAcceptDeadlines(scope: Scope, now = new Date()) {
  const waiting = (await fulfilmentService(scope).listOrderFulfilments({ state: "new", accept_reminded_at: null })).map(
    asFulfilmentRecord
  )
  const hoursOf = await hoursOfOrders(scope, waiting, now)
  const due = waiting.filter((row) => acceptReminderDue(new Date(row.placed_at).toISOString(), now, hoursOf(row)))
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  // Each order's reminder is its own, so they go out together.
  await Promise.all(
    due.map((row) =>
      remindAcceptDeadlineWorkflow(scope as MedusaContainer)
        .run({ input: { order_id: row.order_id, at: now.toISOString() } })
        .catch((error: unknown) => {
          // Accepted or rejected meanwhile, most likely; the next run looks again.
          logger.warn(`Reminding the shop of order ${row.order_id} failed: ${errorMessage(error)}`)
        })
    )
  )
}

async function isRefundDue(scope: Scope, orderId: string) {
  const money = await orderMoney(scope, orderId, await paymentsOfOrder(scope, orderId))
  return refundPlan(money).length > 0
}

/** How long a captured payment may wait to be split into orders before it counts as unclaimed. */
const SPLIT_GRACE_MS = 30 * 60 * 1000

/**
 * Refunds in full each payment captured in the last week, and at least half an hour ago, that
 * no order claims: the checkout was paid but never became orders (ADR 0003). The backstop to
 * the check made right after Paystack's webhook (#38), under the same lock: a payment refunded
 * there has nothing left to refund here.
 */
export async function refundUnclaimedPayments(scope: Scope, now = new Date()) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: payments } = await query.graph({
    entity: "payment",
    fields: ["id"],
    filters: {
      captured_at: { $gte: new Date(now.getTime() - REFUND_RETRY_MS), $lte: new Date(now.getTime() - SPLIT_GRACE_MS) },
    },
  })
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  for (const { id } of payments as { id: string }[]) {
    try {
      await refundUnplacedPayment(scope, id)
    } catch (error) {
      logger.error(`Refund of unclaimed payment ${id} failed: ${errorMessage(error)}`)
    }
  }
}
