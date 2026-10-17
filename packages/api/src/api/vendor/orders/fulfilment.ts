import type { AuthenticatedMedusaRequest } from "@medusajs/framework/http"
import { validateSellerOrder } from "@mercurjs/core/api/vendor/orders/helpers"

export type VendorRequest<Body = unknown> = AuthenticatedMedusaRequest<Body> & { seller_context?: { seller_id: string } }

/** The shop's own order, or a 404 for any other. */
export async function shopsOwnOrder(req: VendorRequest<unknown>) {
  await validateSellerOrder(req.scope, req.seller_context?.seller_id ?? "", req.params.id)
  return req.params.id
}
