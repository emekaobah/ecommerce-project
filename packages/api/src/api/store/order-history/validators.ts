import { z } from "@medusajs/framework/zod"
import { ORDER_PHASES } from "@oja/domain"

export const StoreGetOrderHistory = z.object({
  /**
   * The buyer's checkouts in progress (all of them: `limit` and `offset` don't apply) or past
   * (paged); both when left out (#54).
   */
  phase: z.enum(ORDER_PHASES).optional(),
  /** An item's name, or part of it, whatever its case: the checkouts with such an item. */
  q: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export type StoreGetOrderHistoryType = z.infer<typeof StoreGetOrderHistory>

export const StoreGetOrderAgain = z.object({
  /** The shop whose part of the order is ordered again. */
  seller_id: z.string().min(1),
})

export type StoreGetOrderAgainType = z.infer<typeof StoreGetOrderAgain>
