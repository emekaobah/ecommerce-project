import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * A shop sees its order's commission only in the order's payout (`GET /vendor/orders/:id/payout`),
 * which is what it is charged. Mercur's commission lines are worked out from the order as placed
 * and don't follow a refund made without an order edit (#23, ADR 0009), so they are refused, and
 * the vendor panel's order summary, which shows them when the route answers, leaves them out.
 */
export function commissionOnlyInPayout(_req: MedusaRequest, res: MedusaResponse, _next: MedusaNextFunction) {
  res.status(403).json({ message: "An order's commission is shown in its payout" })
}
