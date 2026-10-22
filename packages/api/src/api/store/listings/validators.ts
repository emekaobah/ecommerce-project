import { z } from "@medusajs/framework/zod"

export const StoreGetListingParams = z.object({
  region_id: z.string(),
  /**
   * The signed-in buyer's saved address they are delivering to: shops are measured from its pin
   * (ADR 0011). Ignored for a guest or an address that isn't theirs.
   */
  address_id: z.string().optional(),
})

/**
 * The product page's estimate, scoped like a listing: to the address the buyer is delivering to
 * (`address_id`, else their default), for the variant they picked (`variant_id`, else the shop's
 * cheapest).
 */
export const StoreGetDeliveryEstimateParams = StoreGetListingParams.extend({
  variant_id: z.string().optional(),
})

export const StoreGetListingsParams = StoreGetListingParams.extend({
  /** Words the product's name must all hold, in any order and case. */
  q: z.string().trim().max(200).optional(),
  /** A category; its sub-categories' products are included. */
  category_id: z.string().optional(),
  seller_id: z.string().optional(),
  exclude_product_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

/** A shop page's header is scoped to the region, and measured from the buyer's address, like a listing. */
export const StoreGetShopParams = StoreGetListingParams

export type StoreGetDeliveryEstimateParamsType = z.infer<typeof StoreGetDeliveryEstimateParams>
export type StoreGetShopParamsType = z.infer<typeof StoreGetShopParams>
export type StoreGetListingParamsType = z.infer<typeof StoreGetListingParams>
export type StoreGetListingsParamsType = z.infer<typeof StoreGetListingsParams>
