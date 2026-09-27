import { z } from "@medusajs/framework/zod"

export const StoreMergeCart = z.object({
  /** The cart whose lines move in: the guest cart held on the device at sign-in. */
  cart_id: z.string(),
})

export type StoreMergeCartType = z.infer<typeof StoreMergeCart>
