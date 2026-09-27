import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { HttpTypes } from "@medusajs/framework/types"
import { updateLineItemInCartWorkflow } from "@medusajs/medusa/core-flows"
import { refetchCart } from "@mercurjs/core/api/store/carts/helpers"
import { lineItemOfferId, offerLinePrice } from "../../../../../../lib/cart-lines"

type Body = { quantity: number; metadata?: Record<string, unknown> | null; additional_data?: Record<string, unknown> }

/**
 * Replaces Medusa's line item update (same body and query, validated by Medusa's middleware):
 * a quantity change reprices the line at its own offer's current price, never at another
 * shop's price for the same variant (see `lib/cart-lines.ts`). Quantity 0 removes the line.
 */
export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse<HttpTypes.StoreCartResponse>) => {
  const { id: cartId, line_id: lineId } = req.params
  const { additional_data, ...update } = req.validatedBody
  const offerId = update.quantity > 0 ? await lineItemOfferId(req.scope, cartId, lineId) : null
  const price = offerId ? await offerLinePrice(req.scope, cartId, offerId) : null

  await updateLineItemInCartWorkflow(req.scope).run({
    input: {
      cart_id: cartId,
      item_id: lineId,
      update: {
        ...update,
        ...(price
          ? { unit_price: price.unit_price, compare_at_unit_price: price.compare_at_unit_price }
          : {}),
      } as never,
      additional_data,
    },
  })

  const cart = await refetchCart(cartId, req.scope, req.queryConfig.fields)
  res.status(200).json({ cart })
}

// Removing a line needs no pricing: Medusa's own handler, re-exported so this file doesn't hide it.
export { DELETE } from "@medusajs/medusa/api/store/carts/[id]/line-items/[line_id]/route"
