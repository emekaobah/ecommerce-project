import { PRODUCT_NAME } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { paystackClient } from "../modules/paystack"
import { fromSubunit, type PaystackListedRefund } from "../modules/paystack/client"
import { fulfilmentService } from "./order-fulfilment"

// Paystack takes refunds out of the money payouts are paid from (#29). Every refund Oja makes
// is recorded as an order refund (#20), so a payout knows what the buyer kept; a refund made
// any other way, such as by hand in Paystack's dashboard, would be paid out to the shop too.

/** A Paystack refund no order refund records. */
export type UnmatchedRefund = { id: number; amount: number; currency: string; transaction: string | null; status: string }

const transactionOf = (refund: PaystackListedRefund) => {
  const { transaction } = refund
  if (transaction == null) return null
  return typeof transaction === "number" ? String(transaction) : (transaction.reference ?? String(transaction.id))
}

/**
 * Lists Paystack's refunds made from `from` to `to` (ISO 8601) and flags each that no order
 * refund records: a warning in the log and a notice in the admin's notifications.
 */
export async function flagUnmatchedRefunds(scope: MedusaContainer, { from, to }: { from: string; to: string }) {
  const paystack = paystackClient()
  if (!paystack) return []
  const listed = await paystack.listRefunds({ from, to })
  if (!listed.length) return []
  const recorded = await fulfilmentService(scope).listOrderRefunds(
    { paystack_refund_id: listed.map((r) => String(r.id)) },
    { select: ["paystack_refund_id"] }
  )
  const known = new Set(recorded.map((r) => r.paystack_refund_id))
  const unmatched: UnmatchedRefund[] = listed
    .filter((r) => !known.has(String(r.id)))
    .map((r) => ({
      id: r.id,
      amount: fromSubunit(r.amount),
      currency: r.currency,
      transaction: transactionOf(r),
      status: r.status,
    }))
  if (!unmatched.length) return unmatched
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const notifications = scope.resolve(Modules.NOTIFICATION)
  for (const refund of unmatched) {
    const description = `Paystack refund ${refund.id} (${refund.currency} ${refund.amount}, transaction ${refund.transaction ?? "unknown"}) matches no order refund. A shop may be paid out money the buyer got back.`
    logger.warn(description)
    await notifications.createNotifications({
      to: "",
      channel: "feed",
      template: "admin-ui",
      data: { title: `Paystack refund not made by ${PRODUCT_NAME}`, description },
      idempotency_key: `unmatched-paystack-refund:${refund.id}`,
    })
  }
  return unmatched
}

/** The UTC day before `now`, as Paystack's `from` and `to`. */
export function previousDay(now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return { from: new Date(today - 24 * 60 * 60 * 1000).toISOString(), to: new Date(today - 1).toISOString() }
}
