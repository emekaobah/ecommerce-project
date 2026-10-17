import type { MedusaResponse } from "@medusajs/framework/http"
import { cancelAndRefund, cancelPreview } from "../../../../../lib/order-cancellation"
import type { CancelOrderResponse, CancelPreviewResponse } from "../../../../cancel-order"
import { fulfilmentResponse } from "../../../../fulfilment-response"
import { shopsOwnOrder, type VendorRequest } from "../../fulfilment"
import type { VendorCancelOrderType } from "../../validators"

/** Whether the shop can cancel its order now, and what cancelling it would refund its buyer (#17), for staff to confirm. */
export const GET = async (req: VendorRequest, res: MedusaResponse<CancelPreviewResponse>) => {
  const orderId = await shopsOwnOrder(req)
  res.json({ cancel: await cancelPreview(req.scope, orderId) })
}

/**
 * The shop's owners and managers cancel an accepted order with a reason (#17), before a courier
 * label is booked: it is cancelled, its stock returned, and its buyer refunded all that is left
 * of its share of the checkout, never the other shops' orders'. Replaces Mercur's route, which
 * refunded the checkout's whole payment.
 */
export const POST = async (req: VendorRequest<VendorCancelOrderType>, res: MedusaResponse<CancelOrderResponse>) => {
  const orderId = await shopsOwnOrder(req)
  const { fulfilment, refund_amount, refund } = await cancelAndRefund(req.scope, {
    ...req.validatedBody,
    order_id: orderId,
    source: "staff",
    actor: req.auth_context.actor_id,
  })
  res.json({ ...fulfilmentResponse(fulfilment), refund_amount, refund })
}
