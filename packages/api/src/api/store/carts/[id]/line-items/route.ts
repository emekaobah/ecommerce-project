import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { HttpTypes } from "@medusajs/framework/types"
import { addToCartWorkflow } from "@medusajs/medusa/core-flows"
import { defaultStoreCartFields, refetchCart } from "@mercurjs/core/api/store/carts/helpers"
import { offerLinePrice } from "../../../../../lib/cart"

type Body = {
  offer_id: string
  quantity: number
  metadata?: Record<string, unknown>
  additional_data?: Record<string, unknown>
}

/**
 * Replaces Mercur's add-to-cart (same body, validated by Mercur's middleware): the line is
 * priced at its own offer's price and pinned there (see `offerLinePrice`).
 */
export const POST = async (req: MedusaRequest<Body>, res: MedusaResponse<HttpTypes.StoreCartResponse>) => {
  const cartId = req.params.id
  const { additional_data, metadata, offer_id, quantity } = req.validatedBody
  const price = await offerLinePrice(req.scope, cartId, offer_id)

  await addToCartWorkflow(req.scope).run({
    input: {
      cart_id: cartId,
      items: [
        {
          quantity,
          variant_id: price.variant_id,
          unit_price: price.unit_price,
          compare_at_unit_price: price.compare_at_unit_price,
          is_tax_inclusive: price.is_tax_inclusive,
          requires_shipping: true,
          // Mercur's pricing and validation hooks read `offer_id` from the item; its
          // cart refresh links the line to the offer from the metadata.
          offer_id,
          metadata: { ...(metadata ?? {}), offer_id },
        } as never,
      ],
      additional_data,
    },
  })

  const cart = await refetchCart(cartId, req.scope, defaultStoreCartFields)
  res.status(200).json({ cart })
}
