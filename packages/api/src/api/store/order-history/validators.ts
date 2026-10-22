import { z } from "@medusajs/framework/zod"

export const StoreGetOrderHistory = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export type StoreGetOrderHistoryType = z.infer<typeof StoreGetOrderHistory>

export const StoreGetOrderAgain = z.object({
  /** The shop whose part of the order is ordered again. */
  seller_id: z.string().min(1),
})

export type StoreGetOrderAgainType = z.infer<typeof StoreGetOrderAgain>
