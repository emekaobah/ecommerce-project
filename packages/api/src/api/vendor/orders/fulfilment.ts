import type { AuthenticatedMedusaRequest } from "@medusajs/framework/http"
import { validateSellerOrder } from "@mercurjs/core/api/vendor/orders/helpers"
import { fulfilmentView, type FulfilmentRecord, type FulfilmentView } from "../../../lib/order-fulfilment"

export type VendorRequest<Body = unknown> = AuthenticatedMedusaRequest<Body> & { seller_context?: { seller_id: string } }

export type VendorOrderFulfilmentResponse = { fulfilment: FulfilmentView }

/** The shop's own order, or a 404 for any other. */
export async function shopsOwnOrder(req: VendorRequest<unknown>) {
  await validateSellerOrder(req.scope, req.seller_context?.seller_id ?? "", req.params.id)
  return req.params.id
}

/**
 * The response to a transition: what staff now see of the order's fulfilment. A transition
 * never leaves an order New, so it has no accept deadline to count in the shop's hours.
 */
export const fulfilmentResponse = (record: FulfilmentRecord): VendorOrderFulfilmentResponse => ({
  fulfilment: fulfilmentView(record, record.placed_at, null),
})
