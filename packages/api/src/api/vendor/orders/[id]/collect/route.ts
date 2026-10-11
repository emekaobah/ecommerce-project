import type { MedusaResponse } from "@medusajs/framework/http"
import { handoverNames } from "../../../../../lib/order-fulfilment"
import { collectOrderWorkflow } from "../../../../../workflows/order-fulfilment/workflows/collect-order"
import { fulfilmentResponse, shopsOwnOrder, type VendorOrderFulfilmentResponse, type VendorRequest } from "../../fulfilment"
import type { VendorCollectOrderType } from "../../validators"

/**
 * Staff hand a pickup order over against the code its collector shows (#12), recording who
 * handed it over and the collector's name. A wrong code is refused (400) and counted; after
 * five within 15 minutes every code is refused (429) until the window passes. Refused for an
 * order not Ready for pickup, and for a delivery order.
 */
export const POST = async (req: VendorRequest<VendorCollectOrderType>, res: MedusaResponse<VendorOrderFulfilmentResponse>) => {
  const orderId = await shopsOwnOrder(req)
  const { code, collected_by } = req.validatedBody
  const { result } = await collectOrderWorkflow(req.scope).run({
    input: { order_id: orderId, actor: req.auth_context.actor_id, code, collected_by },
  })
  const { check, fulfilment } = result
  // Answered here: Medusa's error handler has no status for too many attempts.
  if (!check.ok && check.reason === "too_many_attempts") {
    res.status(429).json({ type: "too_many_attempts", message: "Too many wrong codes. Try again in a few minutes.", retry_at: check.retryAt } as never)
    return
  }
  if (!check.ok || !fulfilment) {
    res.status(400).json({ type: "invalid_data", message: "That code doesn't match this order." } as never)
    return
  }
  res.json(fulfilmentResponse(fulfilment, await handoverNames(req.scope, [fulfilment])))
}
