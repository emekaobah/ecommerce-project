import type { MedusaStoreRequest } from "@medusajs/framework/http"
import { deliveringToPin } from "../../../lib/listings"

/**
 * The pin a listing route measures shops from: the signed-in buyer's `address_id`, when it is
 * theirs (ADR 0011). The app never sends coordinates.
 */
export function deliveringToOf(req: MedusaStoreRequest<unknown, { address_id?: string }>) {
  const customerId = req.auth_context?.actor_type === "customer" ? req.auth_context.actor_id : null
  return deliveringToPin(req.scope, { customerId, addressId: req.validatedQuery.address_id })
}
