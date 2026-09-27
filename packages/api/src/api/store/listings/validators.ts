import { z } from "@medusajs/framework/zod"

export const StoreGetListingParams = z.object({
  region_id: z.string(),
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

export type StoreGetListingParamsType = z.infer<typeof StoreGetListingParams>
export type StoreGetListingsParamsType = z.infer<typeof StoreGetListingsParams>
