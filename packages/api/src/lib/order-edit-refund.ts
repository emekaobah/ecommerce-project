import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { refundOrderShareWorkflow } from "../workflows/order-fulfilment/workflows/refund-order-share"
import { buyerRefund, type BuyerRefund } from "./buyer-orders"
import { errorMessage } from "./errors"

type Scope = Pick<MedusaContainer, "resolve">

/**
 * Refunds the buyer what an order edit took off the order's total (`editOrderLines`): items
 * removed while picking (#22), or a pickup order's non-perishable lines once Not collected
 * (#32). Returns the refund, or null when there was nothing to refund or Paystack turned it
 * down (e.g. "Insufficient balance"). A refund that didn't go through is logged, and the order
 * still owes the buyer the amount, which keeps it off the shop's payout (`payoutOf`).
 */
export async function refundOrderEdit(
  scope: Scope,
  edit: { order_id: string; removed_amount: number; created_by?: string; note: string }
): Promise<BuyerRefund | null> {
  if (edit.removed_amount <= 0) return null
  try {
    const { result } = await refundOrderShareWorkflow(scope as MedusaContainer).run({
      input: { order_id: edit.order_id, amount: edit.removed_amount, created_by: edit.created_by, note: edit.note },
    })
    return buyerRefund(result)
  } catch (error) {
    scope
      .resolve(ContainerRegistrationKeys.LOGGER)
      .error(`Refund of ${edit.removed_amount} for order ${edit.order_id} (${edit.note}) failed: ${errorMessage(error)}`)
    return null
  }
}
