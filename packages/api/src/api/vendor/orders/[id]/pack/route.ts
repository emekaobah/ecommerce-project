import type { MedusaResponse } from "@medusajs/framework/http"
import { packOrderWorkflow } from "../../../../../workflows/order-fulfilment/workflows/pack-order"
import { fulfilmentResponse, shopsOwnOrder, type VendorOrderFulfilmentResponse, type VendorRequest } from "../../fulfilment"

/**
 * Staff mark an order packed (Picking → Packed), ready for a courier label. Refused until
 * every line on the pick list is picked in full, and for an order not being picked.
 */
export const POST = async (req: VendorRequest, res: MedusaResponse<VendorOrderFulfilmentResponse>) => {
  const orderId = await shopsOwnOrder(req)
  const { result } = await packOrderWorkflow(req.scope).run({
    input: { order_id: orderId, actor: req.auth_context.actor_id },
  })
  res.json(fulfilmentResponse(result))
}
