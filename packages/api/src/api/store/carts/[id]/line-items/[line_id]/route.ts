import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { HttpTypes } from "@medusajs/framework/types"
import { deleteLineItemsWorkflow, updateLineItemInCartWorkflow } from "@medusajs/medusa/core-flows"
import { refetchCart } from "@mercurjs/core/api/store/carts/helpers"
import { lineItemOfferId, offerLinePrice } from "../../../../../../lib/cart-lines"
import { applyShopPromotionsWorkflow } from "../../../../../../workflows/checkout/apply-shop-promotions"

type Body = { quantity: number; metadata?: Record<string, unknown> | null; additional_data?: Record<string, unknown> }

/**
 * Replaces Medusa's line item update (same body and query, validated by Medusa's middleware):
 * a quantity change reprices the line at its own offer's current price, never at another
 * shop's price for the same variant (see `lib/cart-lines.ts`). Quantity 0 removes the line.
 * The cart's promotions are then worked out shop by shop (#6).
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
  await applyShopPromotionsWorkflow(req.scope).run({ input: { cart_id: cartId } })

  const cart = await refetchCart(cartId, req.scope, req.queryConfig.fields)
  res.status(200).json({ cart })
}

/** Replaces Medusa's line item removal: the cart's promotions are then worked out shop by shop (#6). */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse<HttpTypes.StoreLineItemDeleteResponse>) => {
  const { id: cartId, line_id: lineId } = req.params
  await deleteLineItemsWorkflow(req.scope).run({ input: { cart_id: cartId, ids: [lineId] } })
  await applyShopPromotionsWorkflow(req.scope).run({ input: { cart_id: cartId } })

  const cart = await refetchCart(cartId, req.scope, req.queryConfig.fields)
  res.status(200).json({ id: lineId, object: "line-item", deleted: true, parent: cart })
}
