import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { retrieveCartBySeller, type CartBySeller } from "../../../../../lib/cart"
import { mergeCarts } from "../../../../../lib/cart-lines"
import type { StoreMergeCartType } from "./validators"

/**
 * Sign-in on a device holding a guest cart while the buyer already had a cart: the guest
 * cart's lines join the buyer's, so neither set of items is lost. Returns the merged cart by shop.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<StoreMergeCartType>,
  res: MedusaResponse<{ cart: CartBySeller }>
) => {
  await mergeCarts(req.scope, {
    targetId: req.params.id,
    sourceId: req.validatedBody.cart_id,
    customerId: req.auth_context.actor_id,
  })
  res.json({ cart: await retrieveCartBySeller(req.scope, req.params.id) })
}
