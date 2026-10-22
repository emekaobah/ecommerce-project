import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { HttpTypes } from "@medusajs/framework/types"
import { defaultStoreCartFields, refetchCart } from "@mercurjs/core/api/store/carts/helpers"
import { addOffersToCart } from "../../../../../lib/cart-lines"
import type { StoreAddOfferLinesType } from "./validators"

/**
 * Adds several offers to the cart in one call (Order again, #72), each priced as add-to-cart
 * prices one. All or none: an unknown offer is not found, and a shop not taking orders refuses.
 * Its own path, since Mercur's add-to-cart validator takes exactly one offer.
 */
export const POST = async (req: MedusaRequest<StoreAddOfferLinesType>, res: MedusaResponse<HttpTypes.StoreCartResponse>) => {
  await addOffersToCart(req.scope, req.params.id, req.validatedBody.items)
  const cart = await refetchCart(req.params.id, req.scope, defaultStoreCartFields)
  res.status(200).json({ cart })
}
