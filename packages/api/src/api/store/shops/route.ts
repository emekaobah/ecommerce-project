import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { listShops, type ShopWithListings } from "../../../lib/listings"
import { deliveringToOf } from "../listings/delivering-to"
import type { StoreGetShopsParamsType } from "../listings/validators"

export type StoreShopsResponse = { shops: ShopWithListings[]; count: number; offset: number; limit: number }

/**
 * Home's shops near the buyer (#65): each shop once, where its first listing comes in the feed,
 * nearest first from the signed-in buyer's `address_id` (ADR 0011, 0014), with its top listings.
 */
export const GET = async (
  req: MedusaStoreRequest<unknown, StoreGetShopsParamsType>,
  res: MedusaResponse<StoreShopsResponse>
) => {
  const { region_id, category_id, limit, offset } = req.validatedQuery
  const { shops, count } = await listShops(
    req.scope,
    {
      regionId: region_id,
      salesChannelIds: req.publishable_key_context.sales_channel_ids,
      categoryId: category_id,
      deliveringTo: await deliveringToOf(req),
    },
    { limit, offset }
  )
  res.json({ shops, count, offset, limit })
}
