import { z } from "@medusajs/framework/zod"

export const StoreAddOfferLines = z.object({
  /** Offers to add at once, as add-to-cart takes one (Order again, #72). */
  items: z
    .array(
      z.object({
        offer_id: z.string().min(1),
        quantity: z.number().int().positive(),
        metadata: z.record(z.unknown()).optional(),
      })
    )
    .min(1)
    .max(50),
})

export type StoreAddOfferLinesType = z.infer<typeof StoreAddOfferLines>
