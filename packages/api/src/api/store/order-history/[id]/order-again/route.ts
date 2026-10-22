import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { orderAgainPreview, type OrderAgain } from "../../../../../lib/order-again"
import type { StoreGetOrderAgainType } from "../../validators"

/** Ordering one shop's part of the buyer's received order again: each item today, and whether the shop takes orders (#72). */
export const GET = async (
  req: AuthenticatedMedusaRequest<unknown, StoreGetOrderAgainType>,
  res: MedusaResponse<{ order_again: OrderAgain }>
) => {
  const order_again = await orderAgainPreview(req.scope, req.auth_context.actor_id, req.params.id, req.validatedQuery.seller_id)
  res.json({ order_again })
}
