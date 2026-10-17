import type { MedusaResponse } from "@medusajs/framework/http"
import { rejectAndRefund } from "../../../../../lib/order-acceptance"
import { fulfilmentResponse, type OrderFulfilmentResponse } from "../../../../fulfilment-response"
import { shopsOwnOrder, type VendorRequest } from "../../fulfilment"
import type { VendorRejectOrderType } from "../../validators"

/**
 * Staff reject a new order with a reason (New → Rejected): the order is cancelled and its
 * share of the buyer's payment refunded. Any other order is refused.
 */
export const POST = async (
  req: VendorRequest<VendorRejectOrderType>,
  res: MedusaResponse<OrderFulfilmentResponse>
) => {
  const orderId = await shopsOwnOrder(req)
  const fulfilment = await rejectAndRefund(req.scope, {
    order_id: orderId,
    actor: req.auth_context.actor_id,
    reason: req.validatedBody.reason,
  })
  res.json(fulfilmentResponse(fulfilment))
}
