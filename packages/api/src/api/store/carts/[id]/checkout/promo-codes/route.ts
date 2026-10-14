import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { applyPromoCode } from "../../../../../../lib/checkout"
import type { StoreCheckoutResponse } from "../route"
import type { StoreApplyPromoCodeType } from "../validators"

/**
 * Applies a promo code to the cart (#6). Refused (400) with why the buyer can't use it: not a
 * code, expired, not on yet, used up, or not for anything in the cart.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<StoreApplyPromoCodeType>,
  res: MedusaResponse<StoreCheckoutResponse>
) => {
  const checkout = await applyPromoCode(req.scope, {
    cartId: req.params.id,
    customerId: req.auth_context.actor_id,
    code: req.validatedBody.code,
  })
  res.json({ checkout })
}
