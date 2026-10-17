import { z } from "@medusajs/framework/zod"

export const StoreShopCheckout = z.object({
  /** The shop whose items the buyer pays for on their own. */
  seller_id: z.string().trim().min(1),
})

export type StoreShopCheckoutType = z.infer<typeof StoreShopCheckout>
