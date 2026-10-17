import { canCancel, cancelledBy, cancelReasonText, type Cancellation } from "@oja/domain"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { cancelAcceptedOrderWorkflow, type CancelOrderInput } from "../workflows/order-fulfilment/workflows/cancel-order"
import { buyerRefund, type BuyerRefund } from "./buyer-orders"
import { errorMessage } from "./errors"
import { fulfilmentsOf, type FulfilmentRecord } from "./order-fulfilment"
import { cancelRefundOf } from "./owed-refunds"
import { refundOwed } from "./refund-retry"

// The shop's owners and managers, or Oja's operators, cancel an accepted order with a reason
// (#17), and its buyer is refunded all that is left of the order's share of their checkout:
// items and delivery fee, net of discounts, less what was refunded already or settled by hand.
// The shop is paid nothing for it.

type Scope = Pick<MedusaContainer, "resolve">

/** What cancelling an order would do, for staff to confirm: whether it can be, and what it refunds. */
export type CancelPreview = { allowed: boolean; refund_amount: number; currency_code: string }

/** Whether the order can be cancelled now (`canCancel`), and what cancelling it refunds (`cancelRefundOf`). */
export async function cancelPreview(scope: Scope, orderId: string): Promise<CancelPreview> {
  const [{ amount, currency_code }, records] = await Promise.all([cancelRefundOf(scope, orderId), fulfilmentsOf(scope, [orderId])])
  // An order without a fulfilment row yet is New.
  return { allowed: canCancel(records.get(orderId)?.state ?? "new"), refund_amount: amount, currency_code }
}

export type CancelledOrder = {
  fulfilment: FulfilmentRecord
  /** What cancelling it refunds its buyer (`cancelRefundOf`). */
  refund_amount: number
  /** The refund made; null if Paystack turned it down, and the buyer is still owed it. */
  refund: BuyerRefund | null
}

/** The note on a cancelled order's refund: who cancelled it and why. */
const refundNote = (cancellation: Cancellation) =>
  `Order cancelled by ${cancelledBy(cancellation.by)}: ${cancelReasonText(cancellation)}`

/**
 * Cancels an accepted order (`cancelAcceptedOrderWorkflow`), then refunds its buyer all that is
 * left of its share (`refundOwed`, #16): a refund Paystack turns down leaves the order cancelled
 * and owing it, and is retried; one it can't make goes to Oja's team. A refund that fails
 * otherwise is logged: the order still owes it, and the retry job tries it.
 */
export async function cancelAndRefund(scope: Scope, input: CancelOrderInput): Promise<CancelledOrder> {
  const { result } = await cancelAcceptedOrderWorkflow(scope as MedusaContainer).run({ input })
  const { fulfilment } = result.fulfilment
  if (result.refund_amount <= 0 || fulfilment.state !== "cancelled") return { ...result, refund: null }
  try {
    const { refunds } = await refundOwed(scope, {
      order_id: input.order_id,
      created_by: input.actor,
      note: refundNote(fulfilment.cancellation),
    })
    return { ...result, refund: buyerRefund(refunds) }
  } catch (error) {
    scope
      .resolve(ContainerRegistrationKeys.LOGGER)
      .error(`Refund of ${result.refund_amount} for cancelled order ${input.order_id} failed: ${errorMessage(error)}`)
    return { ...result, refund: null }
  }
}
