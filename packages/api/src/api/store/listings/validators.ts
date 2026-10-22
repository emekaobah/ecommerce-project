import { z } from "@medusajs/framework/zod"

/** The region, which delivery estimates are scoped to like a listing. */
export const StoreGetDeliveryEstimateParams = z.object({
  region_id: z.string(),
})

export const StoreGetListingParams = StoreGetDeliveryEstimateParams.extend({
  /**
   * The signed-in buyer's saved address they are delivering to: shops are measured from its pin
   * (ADR 0011). Ignored for a guest or an address that isn't theirs.
   */
  address_id: z.string().optional(),
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

/** Home's shops near the buyer, in a category or all, a page of shops at a time. */
export const StoreGetShopsParams = StoreGetListingParams.extend({
  /** A category; shops selling a product in it or a category below it, with only those listings. */
  category_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).default(0),
})

export type StoreGetShopsParamsType = z.infer<typeof StoreGetShopsParams>
export type StoreGetDeliveryEstimateParamsType = z.infer<typeof StoreGetDeliveryEstimateParams>
export type StoreGetShopParamsType = z.infer<typeof StoreGetShopParams>
export type StoreGetListingParamsType = z.infer<typeof StoreGetListingParams>
export type StoreGetListingsParamsType = z.infer<typeof StoreGetListingsParams>
