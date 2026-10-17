import { z } from "@medusajs/framework/zod"
import { SETTLEMENT_METHODS } from "../../../../../modules/order-fulfilment/models/refund-settlement"

/** How Oja's team sent a refund by hand, and a note for the record. */
export const AdminSettleOwedRefund = z.object({
  method: z.enum(SETTLEMENT_METHODS),
  note: z.string().trim().min(1),
})
export type AdminSettleOwedRefundType = z.infer<typeof AdminSettleOwedRefund>
