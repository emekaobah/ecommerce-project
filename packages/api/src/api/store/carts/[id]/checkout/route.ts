import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { prepareCheckout, retrieveCheckout, type Checkout, type CheckoutPrepared } from "../../../../../lib/checkout"
import type { StoreGetCheckoutParamsType, StorePrepareCheckoutType } from "./validators"

export type StoreCheckoutResponse = { checkout: Checkout }
export type StorePrepareCheckoutResponse = CheckoutPrepared

/**
 * The buyer's checkout: shop by shop with each shop's delivery and the totals. Once Paystack's
 * webhook confirms payment it carries the order group, so the app polls it after paying.
 * Collection points are measured from the delivery address, else from `address_id`.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest<unknown, StoreGetCheckoutParamsType>,
  res: MedusaResponse<StoreCheckoutResponse>
) => {
  const checkout = await retrieveCheckout(req.scope, req.params.id, req.auth_context.actor_id, {
    addressId: req.validatedQuery.address_id,
  })
  res.json({ checkout })
}

/**
 * Reprices every line and sets how each shop's order reaches the buyer: the shops in `pickup`
 * are collected in store (#12), the rest delivered to the address. `price_changes` lists the
 * lines whose shop's price changed, for the buyer to see. Without a delivery address, collection
 * points are measured from `address_id`, the buyer's "Delivering to" saved address.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<StorePrepareCheckoutType>,
  res: MedusaResponse<StorePrepareCheckoutResponse>
) => {
  const { shipping_address, contact, pickup, address_id } = req.validatedBody
  res.json(
    await prepareCheckout(req.scope, {
      cartId: req.params.id,
      customerId: req.auth_context.actor_id,
      shippingAddress: shipping_address,
      contact,
      pickup,
      addressId: address_id,
    })
  )
}
