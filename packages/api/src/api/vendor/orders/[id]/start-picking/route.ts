import type { MedusaResponse } from "@medusajs/framework/http"
import { startPickingWorkflow } from "../../../../../workflows/order-fulfilment/workflows/start-picking"
import { fulfilmentResponse, shopsOwnOrder, type VendorOrderFulfilmentResponse, type VendorRequest } from "../../fulfilment"

/** Staff start picking an accepted order (Accepted → Picking); any other order is refused. */
export const POST = async (req: VendorRequest, res: MedusaResponse<VendorOrderFulfilmentResponse>) => {
  const orderId = await shopsOwnOrder(req)
  const { result } = await startPickingWorkflow(req.scope).run({
    input: { order_id: orderId, actor: req.auth_context.actor_id },
  })
  res.json(fulfilmentResponse(result))
}
