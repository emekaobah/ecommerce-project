import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { chooseDelivery } from "../../../../../../lib/checkout"
import type { StoreCheckoutResponse } from "../route"
import type { StoreChooseDeliveryType } from "../validators"

/** Picks one shop's delivery from the choices checkout quoted it: best value, the cheapest or the fastest. */
export const POST = async (
  req: AuthenticatedMedusaRequest<StoreChooseDeliveryType>,
  res: MedusaResponse<StoreCheckoutResponse>
) => {
  const checkout = await chooseDelivery(req.scope, {
    cartId: req.params.id,
    customerId: req.auth_context.actor_id,
    sellerId: req.validatedBody.seller_id,
    choiceId: req.validatedBody.choice_id,
  })
  res.json({ checkout })
}
