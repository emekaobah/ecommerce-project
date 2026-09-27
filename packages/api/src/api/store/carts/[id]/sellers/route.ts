import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { retrieveCartBySeller, type CartBySeller } from "../../../../../lib/cart"

export type StoreCartBySellerResponse = { cart: CartBySeller }

/** The Cart tab: the cart's items grouped by the shop selling them. */
export const GET = async (req: MedusaStoreRequest, res: MedusaResponse<StoreCartBySellerResponse>) => {
  const cart = await retrieveCartBySeller(req.scope, req.params.id)
  res.json({ cart })
}
