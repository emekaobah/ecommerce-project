import type { MedusaResponse } from "@medusajs/framework/http"
import { bookLabelWorkflow } from "../../../../../workflows/order-fulfilment/workflows/book-label"
import { fulfilmentResponse, shopsOwnOrder, type VendorOrderFulfilmentResponse, type VendorRequest } from "../../fulfilment"

/**
 * Staff book a courier label for a packed order (Packed → Label booked), paid from the
 * platform's Shipbubble wallet; or rebook one whose shipment Shipbubble cancelled. Refused for
 * an order that isn't packed.
 */
export const POST = async (req: VendorRequest, res: MedusaResponse<VendorOrderFulfilmentResponse>) => {
  const orderId = await shopsOwnOrder(req)
  const { result } = await bookLabelWorkflow(req.scope).run({
    input: { order_id: orderId, actor: req.auth_context.actor_id },
  })
  res.json(fulfilmentResponse(result))
}
