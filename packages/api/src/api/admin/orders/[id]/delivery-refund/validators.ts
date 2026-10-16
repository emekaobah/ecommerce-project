import { z } from "@medusajs/framework/zod"

/** A refund of an order's delivery fee; all of what is left of the fee when no amount is given. */
export const AdminRefundDelivery = z.object({
  amount: z.number().positive().optional(),
  note: z.string().optional(),
})
export type AdminRefundDeliveryType = z.infer<typeof AdminRefundDelivery>
