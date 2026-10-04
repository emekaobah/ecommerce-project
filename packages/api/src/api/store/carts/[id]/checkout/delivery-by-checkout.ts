import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * A shop's delivery is priced by the Shipbubble rate checkout quoted it (#23), carried in the
 * shipping method's data, so the store's own shipping-methods route, where the buyer would
 * name the data, is closed: delivery is chosen through `/store/carts/:id/checkout/delivery`.
 */
export function deliveryChosenAtCheckout(_req: MedusaRequest, res: MedusaResponse, _next: MedusaNextFunction) {
  res.status(400).json({ type: "not_allowed", message: "Choose each shop's delivery at checkout" })
}
