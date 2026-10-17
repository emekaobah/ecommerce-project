import { CANCEL_REASONS } from "@oja/domain"
import { z } from "@medusajs/framework/zod"
import type { BuyerRefund } from "../lib/buyer-orders"
import type { CancelPreview } from "../lib/order-cancellation"
import type { OrderFulfilmentResponse } from "./fulfilment-response"

// Cancelling an accepted order (#17) from the vendor app (`/vendor/orders/:id/cancel`,
// `VendorCancelOrder`) or the admin (`/admin/orders/:id/cancel`, `AdminCancelOrder`): the same
// reasons, the same answers.

/** Why the order is cancelled (`CancelRequest`), which its buyer is shown; `other` needs a note saying what. */
export const cancelOrderBody = z
  .object({
    reason: z.enum(CANCEL_REASONS),
    note: z
      .string()
      .trim()
      .max(500)
      .transform((note) => note || undefined)
      .optional(),
  })
  .strict()
  .refine((body) => body.reason !== "other" || !!body.note, { message: "Say why the order is cancelled", path: ["note"] })

export type CancelPreviewResponse = { cancel: CancelPreview }

export type CancelOrderResponse = OrderFulfilmentResponse & {
  /** What cancelling it refunds its buyer: all that was left of its share, less what Oja's team sends by hand. */
  refund_amount: number
  /** The refund made; null if Paystack turned it down, and the buyer is still owed it (retried, #16). */
  refund: BuyerRefund | null
}
