import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Promo codes are entered at checkout (#6), through `/store/carts/:id/checkout/promo-codes`,
 * which works a shop's promotions out on its own items and says why a code can't be used. The
 * store's own promotions route, which does neither, is closed.
 */
export function promoCodesAtCheckout(_req: MedusaRequest, res: MedusaResponse, _next: MedusaNextFunction) {
  res.status(400).json({ type: "not_allowed", message: "Enter promo codes at checkout" })
}
