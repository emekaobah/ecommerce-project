import type { MedusaResponse } from "@medusajs/framework/http"
import { handoverNames } from "../../../../../lib/order-fulfilment"
import { confirmHandoverWorkflow } from "../../../../../workflows/order-fulfilment/workflows/confirm-handover"
import { fulfilmentResponse, type OrderFulfilmentResponse } from "../../../../fulfilment-response"
import { shopsOwnOrder, type VendorRequest } from "../../fulfilment"

/**
 * Staff confirm they handed the parcel to the courier (#25), recorded with who and when. The
 * order is Handed to courier once Shipbubble has reported the pickup too. Refused before the
 * courier confirmed the pickup, and once staff have confirmed it.
 */
export const POST = async (req: VendorRequest, res: MedusaResponse<OrderFulfilmentResponse>) => {
  const orderId = await shopsOwnOrder(req)
  const { result } = await confirmHandoverWorkflow(req.scope).run({
    input: { order_id: orderId, actor: req.auth_context.actor_id },
  })
  res.json(fulfilmentResponse(result, await handoverNames(req.scope, [result])))
}
