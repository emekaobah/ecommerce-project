import { z } from "@medusajs/framework/zod"
import { cancelOrderBody } from "../../cancel-order"

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

/** The code a pickup order's collector shows (scanned or typed), and the name they give (#12). */
export const VendorCollectOrder = z
  .object({
    code: z.string().trim().min(1).max(32),
    collected_by: z.string().trim().min(1, "Enter the collector's name").max(200),
  })
  .strict()
export type VendorCollectOrderType = z.infer<typeof VendorCollectOrder>

/** How many of a line are unavailable (#22); none clears the mark. Never past the units not yet picked. */
export const VendorMarkUnavailable = z.object({ quantity: z.number().int().min(0) }).strict()
export type VendorMarkUnavailableType = z.infer<typeof VendorMarkUnavailable>

/** Why owners and managers cancel an accepted order (#17): the reasons Oja's operators give too (`cancelOrderBody`). */
export const VendorCancelOrder = cancelOrderBody
export type VendorCancelOrderType = z.infer<typeof VendorCancelOrder>
