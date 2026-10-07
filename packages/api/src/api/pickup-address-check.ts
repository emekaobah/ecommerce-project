import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { validatedPickupChange, type DeliveryAddress } from "../lib/delivery"

type AddressRequest = MedusaRequest<DeliveryAddress> & {
  validatedBody?: DeliveryAddress
  seller_context?: { seller_id: string }
}

/**
 * Mercur's own seller address routes (vendor and admin) save the pickup address too, so they
 * validate it with Shipbubble first, like the onboarding checklist (#26): an address Shipbubble
 * can't place is refused before anything is saved, and a saved one always carries its own
 * address code. Body and validated body both get the code, whichever order the route's
 * validation middleware runs in.
 */
export async function validatePickupAddressFirst(req: AddressRequest, _res: MedusaResponse, next: MedusaNextFunction) {
  // A member asking for another shop is refused by Mercur's own scope check, after this.
  if (req.seller_context && req.seller_context.seller_id !== req.params.id) return next()
  try {
    const change = (req.validatedBody ?? req.body ?? {}) as DeliveryAddress
    const { metadata } = await validatedPickupChange(req.scope, req.params.id, change)
    req.body = { ...req.body, metadata }
    if (req.validatedBody) req.validatedBody = { ...req.validatedBody, metadata }
    next()
  } catch (error) {
    next(error)
  }
}
