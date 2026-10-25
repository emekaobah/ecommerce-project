import type { AuthContext, MedusaStoreRequest } from "@medusajs/framework/http"
import { deliveringToPin } from "../../../lib/listings"

/** The signed-in buyer's customer id; null for a guest, or another kind of actor. */
export const customerIdOf = (req: { auth_context?: AuthContext }) =>
  req.auth_context?.actor_type === "customer" ? req.auth_context.actor_id : null

/**
 * The pin a listing route measures shops from: the signed-in buyer's `address_id`, when it is
 * theirs (ADR 0011), else the phone's location sent as `near`, snapped to a grid (ADR 0015).
 */
export function deliveringToOf(req: MedusaStoreRequest<unknown, { address_id?: string; near?: string }>) {
  const { address_id, near } = req.validatedQuery
  return deliveringToPin(req.scope, { customerId: customerIdOf(req), addressId: address_id, near })
}
