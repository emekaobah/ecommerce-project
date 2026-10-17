import { z } from "@medusajs/framework/zod"

export const StoreMoveShopToOwnCart = z.object({
  /** The shop whose items the buyer pays for on their own. */
  seller_id: z.string().trim().min(1),
})

export type StoreMoveShopToOwnCartType = z.infer<typeof StoreMoveShopToOwnCart>

export const StoreMoveShopCartBack = z.object({
  /** The shop cart whose items go back to this cart. */
  shop_cart_id: z.string().trim().min(1),
})

export type StoreMoveShopCartBackType = z.infer<typeof StoreMoveShopCartBack>
