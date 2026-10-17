import type { MedusaContainer } from "@medusajs/framework/types"
import { removeUnavailableWorkflow } from "../workflows/order-fulfilment/workflows/remove-unavailable"
import type { BuyerRefund } from "./buyer-orders"
import { refundOrderEdit } from "./order-edit-refund"
import type { FulfilmentRecord } from "./order-fulfilment"
import { UNAVAILABLE_NOTE } from "./order-picking"

// Items staff find unavailable while picking are removed from the order and the buyer is
// refunded exactly what they cost (#22).

type Scope = Pick<MedusaContainer, "resolve">

export type RemovedUnavailable = {
  fulfilment: FulfilmentRecord
  /** What removing the items took off the order's total. */
  removed_amount: number
  /** The refund made for it; null if Paystack turned it down. */
  refund: BuyerRefund | null
}

/**
 * Removes the units marked unavailable from the order, then refunds the buyer what the edit
 * took off its total (`refundOrderEdit`). A refund Paystack turns down leaves the order edited
 * and back in picking, with the amount still owed to the buyer.
 */
export async function removeUnavailableAndRefund(scope: Scope, input: { order_id: string; actor: string }): Promise<RemovedUnavailable> {
  const { result } = await removeUnavailableWorkflow(scope as MedusaContainer).run({ input })
  const refund = await refundOrderEdit(scope, {
    order_id: input.order_id,
    removed_amount: result.removed_amount,
    created_by: input.actor,
    note: UNAVAILABLE_NOTE,
  })
  return { ...result, refund }
}
