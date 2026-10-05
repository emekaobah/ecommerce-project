import { z } from "@medusajs/framework/zod"

/** Staff say why they reject an order; the buyer is told. */
export const VendorRejectOrder = z.object({ reason: z.string().trim().min(1).max(500) })
export type VendorRejectOrderType = z.infer<typeof VendorRejectOrder>

/** How many of a line staff have picked: a whole number, from none up to the quantity ordered. */
export const VendorRecordPick = z.object({ picked: z.number().int().min(0) })
export type VendorRecordPickType = z.infer<typeof VendorRecordPick>
