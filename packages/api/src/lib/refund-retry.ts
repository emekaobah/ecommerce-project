import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  refundOwedWorkflow,
  type RefundOwedInput,
  type RefundOwedResult,
} from "../workflows/order-fulfilment/workflows/refund-owed"
import { tellRefundByHand } from "./buyer-notifications"
import { errorMessage } from "./errors"
import { allOwedRefunds, isDue, PAYSTACK_MIN_REFUND, type OrderOwedRefund } from "./owed-refunds"

// What an order owes its buyer is refunded after the edit that owed it, retried with backoff
// while Paystack refuses, and handed to Oja's team once it can't be made (#16).

type Scope = Pick<MedusaContainer, "resolve">

/**
 * Tries to refund what the order owes its buyer (`refundOwedWorkflow`). A refund that is
 * left for Oja's team to send by hand is handed over (`handOverNew`).
 */
export async function refundOwed(scope: Scope, input: RefundOwedInput): Promise<RefundOwedResult> {
  const { result } = await refundOwedWorkflow(scope as MedusaContainer).run({ input })
  if (result.owed) await handOverNew(scope, [result.owed])
  return result
}

/** The admin's notice of a refund handed to Oja's team: one per order and amount. */
const handOverKey = (owed: OrderOwedRefund) => `owed-refund-by-hand:${owed.order_id}:${owed.amount}`

/**
 * Hands Oja's team each refund left for them to send by hand that isn't theirs yet: one that
 * just became theirs, as the admin's notice of it (`handOverKey`) says.
 */
async function handOverNew(scope: Scope, owed: OrderOwedRefund[]): Promise<void> {
  const manual = owed.filter((o) => o.state === "manual")
  if (!manual.length) return
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "notification",
    fields: ["idempotency_key"],
    filters: { idempotency_key: manual.map(handOverKey) },
  })
  const handedOver = new Set((data as { idempotency_key: string | null }[]).map((n) => n.idempotency_key))
  for (const o of manual.filter((m) => !handedOver.has(handOverKey(m)))) await handOver(scope, o)
}

/**
 * Hands a refund Paystack can't make to Oja's team: a notice in the admin's notifications, and
 * the buyer told by push and email that the team is sending it.
 */
async function handOver(scope: Scope, owed: OrderOwedRefund): Promise<void> {
  const { data } = await scope
    .resolve(ContainerRegistrationKeys.QUERY)
    .graph({ entity: "order", fields: ["display_id"], filters: { id: owed.order_id } })
  const displayId = (data[0] as unknown as { display_id?: number } | undefined)?.display_id
  const why =
    owed.attempts > 0
      ? `Paystack refused it ${owed.attempts} times, last with "${owed.last_error ?? "no reason"}".`
      : `It is under Paystack's ₦${PAYSTACK_MIN_REFUND} minimum.`
  const description = `Order #${displayId} owes its buyer ${owed.currency_code.toUpperCase()} ${owed.amount}. ${why} Send it by hand, then mark it settled under Owed refunds.`
  scope.resolve(ContainerRegistrationKeys.LOGGER).warn(description)
  await Promise.all([
    scope.resolve(Modules.NOTIFICATION).createNotifications({
      to: "",
      channel: "feed",
      template: "admin-ui",
      data: { title: `Refund for order #${displayId} to send by hand`, description },
      idempotency_key: handOverKey(owed),
    }),
    tellRefundByHand(scope, owed),
  ])
}

/** The note on a refund the retry job makes. */
export const RETRY_NOTE = "Refund owed to the buyer, retried"

/**
 * The retry job (#16): refunds what each order owes its buyer once its retry is due (`isDue`),
 * one order at a time, each holding its refund lock, and hands to Oja's team each one Paystack
 * can't make, once: one that became theirs some other way too (a shop's refund leaving less
 * than Paystack's minimum, say). An order whose refund can't be tried is logged, and the
 * others are still tried.
 */
export async function retryOwedRefunds(scope: Scope, now = new Date()): Promise<void> {
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const owed = await allOwedRefunds(scope)
  try {
    await handOverNew(scope, owed)
  } catch (error) {
    logger.warn(`Handing owed refunds to Oja's team failed: ${errorMessage(error)}`)
  }
  for (const o of owed.filter((o) => isDue(o, now))) {
    try {
      await refundOwed(scope, { order_id: o.order_id, note: RETRY_NOTE, retry: { by: "job", at: now.toISOString() } })
    } catch (error) {
      logger.warn(`Retrying the refund owed on order ${o.order_id} failed: ${errorMessage(error)}`)
    }
  }
}

/** The note on a refund an operator retries from the admin. */
export const RETRY_NOW_NOTE = "Refund owed to the buyer, retried by Oja's staff"

/**
 * Oja's staff retry an owed refund now (#16), whatever its backoff, even once it was handed
 * to them. Refused when the order owes nothing, less than Paystack's minimum, or while a
 * refund of it is still in Paystack's hands (`refundOwedWorkflow`).
 */
export function retryOwedRefundNow(scope: Scope, orderId: string, actor: string): Promise<RefundOwedResult> {
  return refundOwed(scope, { order_id: orderId, created_by: actor, note: RETRY_NOW_NOTE, retry: { by: "staff" } })
}

/** An owed refund as Oja's staff see it in the admin's Owed refunds list. */
export type AdminOwedRefund = Omit<OrderOwedRefund, "next_attempt_at"> & {
  next_attempt_at: string | null
  display_id: number
  buyer: { name: string | null; email: string | null }
  shop: string | null
}

/** Every refund an order owes its buyer, oldest order first, for the admin (#16). */
export async function listOwedRefunds(scope: Scope): Promise<AdminOwedRefund[]> {
  const owed = await allOwedRefunds(scope)
  if (!owed.length) return []
  const { data } = await scope.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "order",
    fields: ["id", "display_id", "created_at", "email", "customer.first_name", "customer.last_name", "seller.name"],
    filters: { id: owed.map((o) => o.order_id) },
  })
  type Row = {
    id: string
    display_id: number
    created_at: string | Date
    email?: string | null
    customer?: { first_name?: string | null; last_name?: string | null } | null
    seller?: { name?: string | null } | null
  }
  const orders = new Map((data as unknown as Row[]).map((o) => [o.id, o]))
  return owed
    .flatMap((o) => {
      const order = orders.get(o.order_id)
      if (!order) return []
      const name = [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ")
      return [
        {
          ...o,
          next_attempt_at: o.next_attempt_at?.toISOString() ?? null,
          display_id: order.display_id,
          buyer: { name: name || null, email: order.email ?? null },
          shop: order.seller?.name ?? null,
          created_at: new Date(order.created_at).getTime(),
        },
      ]
    })
    .sort((a, b) => a.created_at - b.created_at)
    .map(({ created_at: _, ...o }) => o)
}
