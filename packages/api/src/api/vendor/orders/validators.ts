import { z } from "@medusajs/framework/zod"

/** Staff say why they reject an order; the buyer is told. */
export const VendorRejectOrder = z.object({ reason: z.string().trim().min(1).max(500) })
export type VendorRejectOrderType = z.infer<typeof VendorRejectOrder>
