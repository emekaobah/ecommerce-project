import { z } from "@medusajs/framework/zod"

/** A page of a shop's or product's published reviews (`GET /store/{sellers,products}/:id/reviews`). */
export const StoreGetPublishedReviews = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).default(0),
})

export type StoreGetPublishedReviewsType = z.infer<typeof StoreGetPublishedReviews>
