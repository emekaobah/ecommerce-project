import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CheckoutAlreadyPaidError, startCheckoutPayment, type CheckoutPaymentStart } from "../../../../../../lib/checkout"
import type { StoreStartCheckoutPaymentType } from "../validators"

export type StoreCheckoutPaymentResponse = CheckoutPaymentStart

/**
 * Starts a Paystack payment for the prepared cart; the app opens `authorization_url`. When a
 * shop's price changed, nothing is started: `payment` is null and `price_changes` says what
 * changed, for the buyer to see before paying the new total.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<StoreStartCheckoutPaymentType>,
  res: MedusaResponse<StoreCheckoutPaymentResponse>
) => {
  try {
    res.json(
      await startCheckoutPayment(req.scope, {
        cartId: req.params.id,
        customerId: req.auth_context.actor_id,
        returnUrl: req.validatedBody.return_url,
      })
    )
  } catch (error) {
    if (!(error instanceof CheckoutAlreadyPaidError)) throw error
    // Answered here: Medusa's error handler swaps a conflict's message for a generic one.
    res.status(409).json({ message: error.message } as never)
  }
}
