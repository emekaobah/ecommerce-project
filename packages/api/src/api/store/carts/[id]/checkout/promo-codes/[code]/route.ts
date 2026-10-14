import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { removePromoCode } from "../../../../../../../lib/checkout"
import type { StoreCheckoutResponse } from "../../route"

/** Takes a promo code the buyer entered off the cart (#6). */
export const DELETE = async (req: AuthenticatedMedusaRequest, res: MedusaResponse<StoreCheckoutResponse>) => {
  const checkout = await removePromoCode(req.scope, {
    cartId: req.params.id,
    customerId: req.auth_context.actor_id,
    code: req.params.code,
  })
  res.json({ checkout })
}
