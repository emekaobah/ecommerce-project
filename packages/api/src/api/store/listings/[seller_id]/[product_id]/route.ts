import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { retrieveListing, type Listing, type ListingProductDetail } from "../../../../../lib/listings"
import { deliveringToOf } from "../../delivering-to"
import type { StoreGetListingParamsType } from "../../validators"

export type StoreListingResponse = { listing: Listing<ListingProductDetail> }

/** The product page: one shop's offer of a product, never the cheapest across shops, with how far the shop is. */
export const GET = async (
  req: MedusaStoreRequest<unknown, StoreGetListingParamsType>,
  res: MedusaResponse<StoreListingResponse>
) => {
  const listing = await retrieveListing(req.scope, {
    regionId: req.validatedQuery.region_id,
    salesChannelIds: req.publishable_key_context.sales_channel_ids,
    sellerId: req.params.seller_id,
    productId: req.params.product_id,
    deliveringTo: await deliveringToOf(req),
  })
  res.json({ listing })
}
