import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { retrieveShop, type Shop } from "../../../../lib/listings"
import type { StoreGetListingParamsType } from "../../listings/validators"

export type StoreShopResponse = { shop: Shop }

/** A shop page's header; its listings come from `GET /store/listings?seller_id=`. */
export const GET = async (
  req: MedusaStoreRequest<unknown, StoreGetListingParamsType>,
  res: MedusaResponse<StoreShopResponse>
) => {
  const shop = await retrieveShop(req.scope, { regionId: req.validatedQuery.region_id, sellerId: req.params.seller_id })
  res.json({ shop })
}
