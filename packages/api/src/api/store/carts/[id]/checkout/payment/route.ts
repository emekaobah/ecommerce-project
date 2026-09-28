import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { startCheckoutPayment, type CheckoutPayment } from "../../../../../../lib/checkout"
import type { StoreStartCheckoutPaymentType } from "../validators"

export type StoreCheckoutPaymentResponse = { payment: CheckoutPayment }

/** Starts a Paystack payment for the prepared cart; the app opens `authorization_url`. */
export const POST = async (
  req: AuthenticatedMedusaRequest<StoreStartCheckoutPaymentType>,
  res: MedusaResponse<StoreCheckoutPaymentResponse>
) => {
  const payment = await startCheckoutPayment(req.scope, {
    cartId: req.params.id,
    customerId: req.auth_context.actor_id,
    returnUrl: req.validatedBody.return_url,
  })
  res.json({ payment })
}
