import type { MedusaResponse } from "@medusajs/framework/http"
import { CheckoutAlreadyPaidError } from "../../../lib/checkout"

/**
 * Runs a route's step on a buyer's cart, answering 409 when the cart's current Paystack
 * transaction is already paid: its order is on the way. Answered here: Medusa's error handler
 * swaps a conflict's message for a generic one.
 */
export async function answeringAlreadyPaid<Body>(res: MedusaResponse<Body>, step: () => Promise<void>) {
  try {
    await step()
  } catch (error) {
    if (!CheckoutAlreadyPaidError.is(error)) throw error
    // The route types its success body; a refusal is answered in Medusa's error shape.
    res.status(409).json({ message: error.message } as never)
  }
}
