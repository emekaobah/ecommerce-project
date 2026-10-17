import { CANCEL_REASONS } from "@oja/domain"
import { z } from "@medusajs/framework/zod"
import type { FulfilmentView } from "../lib/order-fulfilment"
import type { BuyerRefund } from "../lib/buyer-orders"
import type { CancelPreview } from "../lib/order-cancellation"

// Cancelling an accepted order (#17) from the vendor app (`/vendor/orders/:id/cancel`) or the
// admin (`/admin/orders/:id/cancel`): the same reasons, the same answers.

/** Why the order is cancelled, which its buyer is shown; `other` needs a note saying what. */
export const CancelOrderBody = z
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
export type CancelOrderBodyType = z.infer<typeof CancelOrderBody>

export type CancelPreviewResponse = { cancel: CancelPreview }

export type CancelOrderResponse = {
  fulfilment: FulfilmentView
  /** All that was left of the order's share: what its buyer is refunded. */
  refund_amount: number
  /** The refund made; null if Paystack turned it down, and the buyer is still owed it (retried, #16). */
  refund: BuyerRefund | null
}
