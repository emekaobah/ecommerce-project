import { z } from "@medusajs/framework/zod"

export const StoreGetWishlist = z.object({
  region_id: z.string(),
})

export const StoreCreateWishlist = z.object({
  reference: z.enum(["product"]),
  reference_id: z.string(),
  /** The shop the product is saved from. */
  seller_id: z.string(),
})

export const StoreMoveWishlistToCart = z.object({
  cart_id: z.string(),
  /** Which of the shop's offers; may be left out when it sells the product in one variant only. */
  offer_id: z.string().optional(),
  quantity: z.number().int().min(1).default(1),
})

export type StoreGetWishlistType = z.infer<typeof StoreGetWishlist>
export type StoreCreateWishlistType = z.infer<typeof StoreCreateWishlist>
export type StoreMoveWishlistToCartType = z.infer<typeof StoreMoveWishlistToCart>
