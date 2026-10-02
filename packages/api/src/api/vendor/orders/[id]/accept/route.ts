import type { MedusaResponse } from "@medusajs/framework/http"
import { acceptOrderWorkflow } from "../../../../../workflows/order-fulfilment/workflows/accept-order"
import { fulfilmentResponse, shopsOwnOrder, type VendorOrderFulfilmentResponse, type VendorRequest } from "../../fulfilment"

/** Staff accept a new order (New → Accepted); any other order is refused. */
export const POST = async (req: VendorRequest, res: MedusaResponse<VendorOrderFulfilmentResponse>) => {
  const orderId = await shopsOwnOrder(req)
  const { result } = await acceptOrderWorkflow(req.scope).run({
    input: { order_id: orderId, actor: req.auth_context.actor_id },
  })
  res.json(fulfilmentResponse(result))
}
