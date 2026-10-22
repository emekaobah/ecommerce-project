import { z } from "@medusajs/framework/zod"
import { createFindParams } from "@medusajs/medusa/api/utils/validators"

/** A page of a stage's orders, with the order fields the list shows (Mercur's order defaults otherwise). */
export const VendorGetStageOrders = createFindParams({ offset: 0, limit: 50 }).merge(
  z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
)
export type VendorGetStageOrdersType = z.infer<typeof VendorGetStageOrders>
