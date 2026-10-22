import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { listListings, type Listing } from "../../../lib/listings"
import { deliveringToOf } from "./delivering-to"
import type { StoreGetListingsParamsType } from "./validators"

export type StoreListingsResponse = {
  listings: Listing[]
  count: number
  /** How many shops the matching listings come from, across every page (search's "2 shops · 5 products"). */
  shop_count: number
  offset: number
  limit: number
}

/**
 * The buyer's feed: one listing per shop and product, visible in the region, nearest first from
 * the signed-in buyer's `address_id` when they send one (ADR 0011).
 */
export const GET = async (
  req: MedusaStoreRequest<unknown, StoreGetListingsParamsType>,
  res: MedusaResponse<StoreListingsResponse>
) => {
  const { region_id, q, category_id, seller_id, exclude_product_id, limit, offset } = req.validatedQuery
  const { listings, count, shopCount } = await listListings(
    req.scope,
    {
      regionId: region_id,
      salesChannelIds: req.publishable_key_context.sales_channel_ids,
      search: q,
      categoryId: category_id,
      sellerId: seller_id,
      excludeProductId: exclude_product_id,
      deliveringTo: await deliveringToOf(req),
    },
    { limit, offset }
  )
  res.json({ listings, count, shop_count: shopCount, offset, limit })
}
