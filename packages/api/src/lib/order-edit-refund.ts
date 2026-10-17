import type { MedusaContainer } from "@medusajs/framework/types"
import { buyerRefund, type BuyerRefund } from "./buyer-orders"
import { refundOwed } from "./refund-retry"

type Scope = Pick<MedusaContainer, "resolve">

/**
 * Refunds the buyer what an order edit took off the order's total (`editOrderLines`): items
 * removed while picking (#22), or a pickup order's non-perishable lines once Not collected
 * (#32). Returns the refund, or null when there was nothing to refund or it wasn't made. Until
 * it is made the order still owes the buyer the amount, which keeps it off the shop's payout
 * (`payoutOf`): a refund Paystack refuses (e.g. "Insufficient balance") is retried by the
 * retry job, and one it can't make goes to Oja's team (`refundOwed`, #16).
 */
export async function refundOrderEdit(
  scope: Scope,
  edit: { order_id: string; removed_amount: number; created_by?: string; note: string }
): Promise<BuyerRefund | null> {
  if (edit.removed_amount <= 0) return null
  const { refunds } = await refundOwed(scope, { order_id: edit.order_id, created_by: edit.created_by, note: edit.note })
  return buyerRefund(refunds)
}
