import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { checkoutOfOrder, type AdminCheckout } from "../../../../../lib/admin-checkout"

export type AdminOrderCheckoutResponse = { checkout: AdminCheckout }

/**
 * The checkout the order was placed in, for the admin's order page (#14): every order of it with
 * its own payment status, and the checkout's one Paystack payment.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse<AdminOrderCheckoutResponse>) {
  res.json({ checkout: await checkoutOfOrder(req.scope, req.params.id) })
}
