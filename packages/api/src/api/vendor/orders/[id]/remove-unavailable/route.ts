import type { MedusaResponse } from "@medusajs/framework/http"
import type { BuyerRefund } from "../../../../../lib/buyer-orders"
import { removeUnavailableAndRefund } from "../../../../../lib/order-availability"
import { pickListOf, type PickList } from "../../../../../lib/order-picking"
import { fulfilmentResponse, type OrderFulfilmentResponse } from "../../../../fulfilment-response"
import { shopsOwnOrder, type VendorRequest } from "../../fulfilment"

export type VendorRemoveUnavailableResponse = OrderFulfilmentResponse & {
  pick_list: PickList
  /** What removing the items took off the order's total: the buyer's refund. */
  removed_amount: number
  /** The refund made; null if Paystack turned it down, and the buyer is still owed it. */
  refund: BuyerRefund | null
}

/**
 * Staff remove the items marked unavailable from the order (#22): the order is edited, the
 * buyer refunded exactly what the items cost, and the order goes back from Partially
 * available to Picking. Refused with nothing marked, and, with the code `cancel_instead`, when
 * every item is marked unavailable: the app offers to cancel the order instead (#17).
 */
export const POST = async (req: VendorRequest, res: MedusaResponse<VendorRemoveUnavailableResponse>) => {
  const orderId = await shopsOwnOrder(req)
  const { fulfilment, removed_amount, refund } = await removeUnavailableAndRefund(req.scope, {
    order_id: orderId,
    actor: req.auth_context.actor_id,
  })
  res.json({
    ...fulfilmentResponse(fulfilment),
    pick_list: await pickListOf(req.scope, orderId),
    removed_amount,
    refund,
  })
}
