import { z } from "@medusajs/framework/zod"

export const StoreGetOrderHistory = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export type StoreGetOrderHistoryType = z.infer<typeof StoreGetOrderHistory>
