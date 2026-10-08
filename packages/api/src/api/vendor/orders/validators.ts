import { z } from "@medusajs/framework/zod"

/** Staff say why they reject an order; the buyer is told. */
export const VendorRejectOrder = z.object({ reason: z.string().trim().min(1).max(500) })
export type VendorRejectOrderType = z.infer<typeof VendorRejectOrder>

/**
 * A line's pick: `picked` sets how many are picked (a tap), `add` picks that many more (a
 * scan, so scans from two phones both count). Never past the quantity ordered.
 */
export const VendorRecordPick = z.union([
  z.object({ picked: z.number().int().min(0) }).strict(),
  z.object({ add: z.number().int().min(1) }).strict(),
])
export type VendorRecordPickType = z.infer<typeof VendorRecordPick>

/** How many of a line are unavailable (#22); none clears the mark. Never past the units not yet picked. */
export const VendorMarkUnavailable = z.object({ quantity: z.number().int().min(0) }).strict()
export type VendorMarkUnavailableType = z.infer<typeof VendorMarkUnavailable>
