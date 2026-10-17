import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelAndRefund, cancelPreview } from "../../../../../lib/order-cancellation"
import type { CancelOrderBodyType, CancelOrderResponse, CancelPreviewResponse } from "../../../../cancel-order"
import { fulfilmentResponse } from "../../../../vendor/orders/fulfilment"

/** Whether Oja's staff can cancel the order now, and what cancelling it would refund its buyer (#17). */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse<CancelPreviewResponse>) {
  res.json({ cancel: await cancelPreview(req.scope, req.params.id) })
}

/**
 * Oja's staff cancel an accepted order with a reason (#17), to clear one its shop can't: as when
 * the shop cancels it, the buyer is refunded all that is left of the order's share and nothing
 * of the other shops' orders. Replaces Medusa's route, which refunded the checkout's whole payment.
 */
export async function POST(req: AuthenticatedMedusaRequest<CancelOrderBodyType>, res: MedusaResponse<CancelOrderResponse>) {
  const { fulfilment, refund_amount, refund } = await cancelAndRefund(req.scope, {
    ...req.validatedBody,
    order_id: req.params.id,
    source: "operator",
    actor: req.auth_context.actor_id,
  })
  res.json({ ...fulfilmentResponse(fulfilment), refund_amount, refund })
}
