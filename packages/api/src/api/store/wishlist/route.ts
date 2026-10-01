import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listWishlist, shopOfferIds, type WishlistItem } from "../../../lib/wishlist"
import { createWishlistEntryWorkflow } from "../../../workflows/wishlist/workflows/create-wishlist"
import type { StoreCreateWishlistType, StoreGetWishlistType } from "./validators"

/** Saves a product from the shop the buyer found it in. */
export const POST = async (req: AuthenticatedMedusaRequest<StoreCreateWishlistType>, res: MedusaResponse) => {
  const { reference, reference_id, seller_id } = req.validatedBody
  await shopOfferIds(req.scope, seller_id, reference_id)
  await createWishlistEntryWorkflow(req.scope).run({
    input: { reference, reference_id, seller_id, customer_id: req.auth_context.actor_id },
  })
  res.status(201).json({ product_id: reference_id, seller_id })
}

/** The buyer's saved products, newest first, each as its saved shop's listing in the region. */
export const GET = async (
  req: AuthenticatedMedusaRequest<unknown, StoreGetWishlistType>,
  res: MedusaResponse<{ items: WishlistItem[] }>
) => {
  const items = await listWishlist(req.scope, req.auth_context.actor_id, {
    regionId: req.validatedQuery.region_id,
    salesChannelIds: req.publishable_key_context?.sales_channel_ids ?? [],
  })
  res.json({ items })
}
