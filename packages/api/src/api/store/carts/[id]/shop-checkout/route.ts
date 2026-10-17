import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CartBySeller } from "../../../../../lib/cart"
import { CheckoutAlreadyPaidError } from "../../../../../lib/checkout"
import { moveShopToOwnCart } from "../../../../../lib/shop-checkout"
import type { StoreShopCheckoutType } from "./validators"

export type StoreShopCheckoutResponse = { cart: CartBySeller }

/**
 * "Pay for this shop only" (#11): moves the shop's items out of the buyer's cart into a cart of
 * their own, returned by shop, which the app then checks out. The cart keeps the other shops'
 * items. A cart already paid for is refused (409): its order is on the way.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<StoreShopCheckoutType>,
  res: MedusaResponse<StoreShopCheckoutResponse>
) => {
  try {
    const cart = await moveShopToOwnCart(req.scope, {
      cartId: req.params.id,
      customerId: req.auth_context.actor_id,
      sellerId: req.validatedBody.seller_id,
    })
    res.json({ cart })
  } catch (error) {
    if (!(error instanceof CheckoutAlreadyPaidError)) throw error
    // Answered here: Medusa's error handler swaps a conflict's message for a generic one.
    res.status(409).json({ message: error.message } as never)
  }
}
