import { z } from "@medusajs/framework/zod"

const StoreDeliveringToParams = z.object({
  region_id: z.string(),
  /**
   * The signed-in buyer's saved address they are delivering to: shops are measured from its pin
   * (ADR 0011). Ignored for a guest or an address that isn't theirs.
   */
  address_id: z.string().optional(),
})

export const StoreGetListingParams = StoreDeliveringToParams.extend({
  /**
   * The phone's location as `lat,lng`, for a buyer with no usable `address_id`: shops are measured
   * from it, snapped to a 2-decimal grid (ADR 0015). Ignored when malformed or out of range.
   */
  near: z.string().optional(),
})

/**
 * The product page's estimate, scoped to the saved address the buyer is delivering to
 * (`address_id`, else their default), for the variant they picked (`variant_id`, else the shop's
 * cheapest). Never from `near`: an estimate needs a saved, validated address (ADR 0015).
 */
export const StoreGetDeliveryEstimateParams = StoreDeliveringToParams.extend({
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

/** A shop page's header is scoped to the region, and measured from the buyer's address or `near`, like a listing. */
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
