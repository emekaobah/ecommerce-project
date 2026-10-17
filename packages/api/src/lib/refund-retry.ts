import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  refundOwedWorkflow,
  type RefundOwedInput,
  type RefundOwedResult,
} from "../workflows/order-fulfilment/workflows/refund-owed"
import { errorMessage } from "./errors"
import { allOwedRefunds, isDue, type OrderOwedRefund } from "./owed-refunds"

// What an order owes its buyer is refunded after the edit that owed it, retried with backoff
// while Paystack refuses, and handed to Oja's team once it can't be made (#16).

type Scope = Pick<MedusaContainer, "resolve">

/** Tries to refund what the order owes its buyer (`refundOwedWorkflow`). */
export async function refundOwed(scope: Scope, input: RefundOwedInput): Promise<RefundOwedResult> {
  const { result } = await refundOwedWorkflow(scope as MedusaContainer).run({ input })
  return result
}

/** The note on a refund the retry job makes. */
export const RETRY_NOTE = "Refund owed to the buyer, retried"

/**
 * The retry job (#16): refunds what each order owes its buyer once its retry is due (`isDue`),
 * one order at a time, each holding its refund lock. An order whose refund one attempt can't
 * make is logged, and the others are still tried.
 */
export async function retryOwedRefunds(scope: Scope, now = new Date()): Promise<void> {
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  for (const owed of await allOwedRefunds(scope)) {
    if (!isDue(owed, now)) continue
    try {
      await refundOwed(scope, { order_id: owed.order_id, note: RETRY_NOTE, retry_at: now.toISOString() })
    } catch (error) {
      logger.warn(`Retrying the refund owed on order ${owed.order_id} failed: ${errorMessage(error)}`)
    }
  }
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
