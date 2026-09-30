import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CartBySeller } from "../../../../../../lib/cart"
import { moveToCart } from "../../../../../../lib/wishlist"
import type { StoreMoveWishlistToCartType } from "../../../validators"

/** Moves a saved product into the buyer's cart as its saved shop's offer. Returns the cart by shop. */
export const POST = async (
  req: AuthenticatedMedusaRequest<StoreMoveWishlistToCartType>,
  res: MedusaResponse<{ cart: CartBySeller }>
) => {
  const { cart_id, offer_id, quantity } = req.validatedBody
  const cart = await moveToCart(req.scope, {
    customerId: req.auth_context.actor_id,
    productId: req.params.reference_id,
    cartId: cart_id,
    offerId: offer_id,
    quantity,
  })
  res.json({ cart })
}
