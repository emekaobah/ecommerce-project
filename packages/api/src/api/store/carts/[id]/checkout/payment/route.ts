import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { startCheckoutPayment, type CheckoutPaymentStart } from "../../../../../../lib/checkout"
import { answeringAlreadyPaid } from "../../../already-paid"
import type { StoreStartCheckoutPaymentType } from "../validators"

export type StoreCheckoutPaymentResponse = CheckoutPaymentStart

/**
 * Starts a Paystack payment for the prepared cart; the app opens `authorization_url`. When a
 * shop's price changed or a line sold out, nothing is started: `payment` is null, and
 * `price_changes` and `stock_changes` say what changed, for the buyer to see before paying the
 * new total.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<StoreStartCheckoutPaymentType>,
  res: MedusaResponse<StoreCheckoutPaymentResponse>
) =>
  answeringAlreadyPaid(res, async () => {
    res.json(
      await startCheckoutPayment(req.scope, {
        cartId: req.params.id,
        customerId: req.auth_context.actor_id,
        returnUrl: req.validatedBody.return_url,
      })
    )
  })
