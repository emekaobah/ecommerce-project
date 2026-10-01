import { acceptDeadline } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { refundOrderShareWorkflow } from "../workflows/order-fulfilment/workflows/refund-order-share"
import { rejectOrderWorkflow } from "../workflows/order-fulfilment/workflows/reject-order"
import { errorMessage } from "./errors"
import { asFulfilmentRecord, fulfilmentService, orderMoney, paymentsOfOrder } from "./order-fulfilment"
import { refundPlan } from "./order-refund"

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

async function refundRejected(scope: Scope, orderId: string, actor: string | undefined, reason: string) {
  try {
    await refundOrderShareWorkflow(scope as MedusaContainer).run({
      input: { order_id: orderId, created_by: actor, note: `Order rejected: ${reason}` },
    })
  } catch (error) {
    scope.resolve(ContainerRegistrationKeys.LOGGER).error(`Refund of rejected order ${orderId} failed: ${errorMessage(error)}`)
  }
}

/**
 * The accept-deadline job: rejects and refunds every new order past its deadline, and tries
 * again to refund recently rejected orders whose refund didn't go through.
 */
export async function rejectOverdueOrders(scope: Scope, now = new Date()) {
  const service = fulfilmentService(scope)
  const waiting = (await service.listOrderFulfilments({ state: "new" })).map(asFulfilmentRecord)
  const overdue = waiting.filter((row) => Date.parse(acceptDeadline(new Date(row.placed_at).toISOString())) <= now.getTime())
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
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
    if (await isRefundDue(scope, row.order_id)) {
      await refundRejected(scope, row.order_id, undefined, row.reject_reason ?? DEADLINE_REASON)
    }
  }
}

async function isRefundDue(scope: Scope, orderId: string) {
  const money = await orderMoney(scope, orderId, await paymentsOfOrder(scope, orderId))
  return refundPlan(money).length > 0
}
