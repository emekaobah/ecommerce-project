import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Money is captured only when Paystack's webhook confirms the charge (docs/adr/0003), so a
 * shop can't mark a payment captured from the vendor panel.
 */
export function refuseVendorCapture(_req: MedusaRequest, res: MedusaResponse, _next: MedusaNextFunction) {
  res.status(403).json({ message: "Payments are captured when Paystack confirms them" })
}
