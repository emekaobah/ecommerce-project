import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { prepareCheckout, retrieveCheckout, type Checkout, type CheckoutPriceChange } from "../../../../../lib/checkout"
import type { StorePrepareCheckoutType } from "./validators"

export type StoreCheckoutResponse = { checkout: Checkout }
export type StorePrepareCheckoutResponse = StoreCheckoutResponse & { price_changes: CheckoutPriceChange[] }

/**
 * The buyer's checkout: shop by shop with each shop's delivery and the totals. Once Paystack's
 * webhook confirms payment it carries the order group, so the app polls it after paying.
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse<StoreCheckoutResponse>) => {
  res.json({ checkout: await retrieveCheckout(req.scope, req.params.id, req.auth_context.actor_id) })
}

/**
 * Sets the delivery address, reprices every line and adds each shop's delivery. `price_changes`
 * lists the lines whose shop's price changed, for the buyer to see.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<StorePrepareCheckoutType>,
  res: MedusaResponse<StorePrepareCheckoutResponse>
) => {
  res.json(
    await prepareCheckout(req.scope, {
      cartId: req.params.id,
      customerId: req.auth_context.actor_id,
      shippingAddress: req.validatedBody.shipping_address,
    })
  )
}
