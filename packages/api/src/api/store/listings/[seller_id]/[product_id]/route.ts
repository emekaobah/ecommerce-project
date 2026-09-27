import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { retrieveListing, type Listing, type ListingProductDetail } from "../../../../../lib/listings"
import type { StoreGetListingParamsType } from "../../validators"

export type StoreListingResponse = { listing: Listing<ListingProductDetail> }

/** The product page: one shop's offer of a product, never the cheapest across shops. */
export const GET = async (
  req: MedusaRequest<unknown, StoreGetListingParamsType>,
  res: MedusaResponse<StoreListingResponse>
) => {
  const listing = await retrieveListing(req.scope, {
    regionId: req.validatedQuery.region_id,
    sellerId: req.params.seller_id,
    productId: req.params.product_id,
  })
  res.json({ listing })
}
