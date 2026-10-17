import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { removeUnavailableWorkflow } from "../workflows/order-fulfilment/workflows/remove-unavailable"
import type { BuyerRefund } from "./buyer-orders"
import { refundOrderEdit } from "./order-edit-refund"
import type { FulfilmentRecord } from "./order-fulfilment"
import { pickListOf, UNAVAILABLE_NOTE } from "./order-picking"

// Items staff find unavailable while picking are removed from the order and the buyer is
// refunded exactly what they cost (#22). When every item is unavailable there would be nothing
// left to send, so the order is cancelled instead (#17).

type Scope = Pick<MedusaContainer, "resolve">

/**
 * The error code of a removal refused because every item is marked unavailable: the app offers
 * to cancel the order instead (`POST /vendor/orders/:id/cancel`, #17).
 */
export const CANCEL_INSTEAD = "cancel_instead"

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
 * and back in picking, with the amount still owed to the buyer. Refused with `cancel_instead`
 * when every item is marked unavailable.
 */
export async function removeUnavailableAndRefund(scope: Scope, input: { order_id: string; actor: string }): Promise<RemovedUnavailable> {
  if ((await pickListOf(scope, input.order_id)).progress.allUnavailable) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Every item of order ${input.order_id} is unavailable: cancel the order instead, which refunds it in full`,
      CANCEL_INSTEAD
    )
  }
  const { result } = await removeUnavailableWorkflow(scope as MedusaContainer).run({ input })
  const refund = await refundOrderEdit(scope, {
    order_id: input.order_id,
    removed_amount: result.removed_amount,
    created_by: input.actor,
    note: UNAVAILABLE_NOTE,
  })
  return { ...result, refund }
}
