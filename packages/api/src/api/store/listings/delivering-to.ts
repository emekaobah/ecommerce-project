import type { AuthContext, MedusaStoreRequest } from "@medusajs/framework/http"
import { deliveringToPin } from "../../../lib/listings"

/** The signed-in buyer's customer id; null for a guest, or another kind of actor. */
export const customerIdOf = (req: { auth_context?: AuthContext }) =>
  req.auth_context?.actor_type === "customer" ? req.auth_context.actor_id : null

/**
 * The pin a listing route measures shops from: the signed-in buyer's `address_id`, when it is
 * theirs (ADR 0011). The app never sends coordinates.
 */
export function deliveringToOf(req: MedusaStoreRequest<unknown, { address_id?: string }>) {
  return deliveringToPin(req.scope, { customerId: customerIdOf(req), addressId: req.validatedQuery.address_id })
}
