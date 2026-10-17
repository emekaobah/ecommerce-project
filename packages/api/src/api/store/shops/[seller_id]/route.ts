import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { retrieveShop, type Shop } from "../../../../lib/listings"
import { deliveringToOf } from "../../listings/delivering-to"
import type { StoreGetShopParamsType } from "../../listings/validators"

export type StoreShopResponse = { shop: Shop }

/** A shop page's header; its listings come from `GET /store/listings?seller_id=`. */
export const GET = async (
  req: MedusaStoreRequest<unknown, StoreGetShopParamsType>,
  res: MedusaResponse<StoreShopResponse>
) => {
  const shop = await retrieveShop(req.scope, {
    regionId: req.validatedQuery.region_id,
    sellerId: req.params.seller_id,
    deliveringTo: await deliveringToOf(req),
  })
  res.json({ shop })
}
