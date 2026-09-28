import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { listListings, type Listing } from "../../../lib/listings"
import type { StoreGetListingsParamsType } from "./validators"

export type StoreListingsResponse = { listings: Listing[]; count: number; offset: number; limit: number }

/** The buyer's feed: one listing per shop and product, visible in the region. */
export const GET = async (
  req: MedusaStoreRequest<unknown, StoreGetListingsParamsType>,
  res: MedusaResponse<StoreListingsResponse>
) => {
  const { region_id, q, category_id, seller_id, exclude_product_id, limit, offset } = req.validatedQuery
  const { listings, count } = await listListings(
    req.scope,
    {
      regionId: region_id,
      salesChannelIds: req.publishable_key_context.sales_channel_ids,
      search: q,
      categoryId: category_id,
      sellerId: seller_id,
      excludeProductId: exclude_product_id,
    },
    { limit, offset }
  )
  res.json({ listings, count, offset, limit })
}
