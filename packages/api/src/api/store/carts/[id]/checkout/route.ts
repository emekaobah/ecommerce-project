import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { prepareCheckout, retrieveCheckout, type Checkout, type CheckoutPrepared } from "../../../../../lib/checkout"
import type { StorePrepareCheckoutType } from "./validators"

export type StoreCheckoutResponse = { checkout: Checkout }
export type StorePrepareCheckoutResponse = CheckoutPrepared

/**
 * The buyer's checkout: shop by shop with each shop's delivery and the totals. Once Paystack's
 * webhook confirms payment it carries the order group, so the app polls it after paying.
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse<StoreCheckoutResponse>) => {
  res.json({ checkout: await retrieveCheckout(req.scope, req.params.id, req.auth_context.actor_id) })
}

/**
 * Reprices every line and sets how each shop's order reaches the buyer: the shops in `pickup`
 * are collected in store (#12), the rest delivered to the address. `price_changes` lists the
 * lines whose shop's price changed, for the buyer to see.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<StorePrepareCheckoutType>,
  res: MedusaResponse<StorePrepareCheckoutResponse>
) => {
  const { shipping_address, contact, pickup } = req.validatedBody
  res.json(
    await prepareCheckout(req.scope, {
      cartId: req.params.id,
      customerId: req.auth_context.actor_id,
      shippingAddress: shipping_address,
      contact,
      pickup,
    })
  )
}
