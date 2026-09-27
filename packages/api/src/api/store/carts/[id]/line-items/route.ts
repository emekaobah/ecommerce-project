import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { HttpTypes } from "@medusajs/framework/types"
import { defaultStoreCartFields, refetchCart } from "@mercurjs/core/api/store/carts/helpers"
import { addOffersToCart, type OfferLine } from "../../../../../lib/cart-lines"

type Body = OfferLine & { additional_data?: Record<string, unknown> }

/**
 * Replaces Mercur's add-to-cart (same body, validated by Mercur's middleware): the line is
 * priced at its own offer's price and pinned there (see `lib/cart-lines.ts`).
 */
export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse<HttpTypes.StoreCartResponse>) => {
  const { additional_data, ...line } = req.validatedBody
  await addOffersToCart(req.scope, req.params.id, [line], additional_data)

  const cart = await refetchCart(req.params.id, req.scope, defaultStoreCartFields)
  res.status(200).json({ cart })
}
