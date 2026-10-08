import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * An order's courier fulfilments are booked by `POST /vendor/orders/:id/book-label` and
 * cancelled by Shipbubble (#24), each moving the order's fulfilment state with it. Mercur's own
 * vendor routes would create or cancel one without the state knowing, so they are closed.
 */
export function courierFulfilmentsByLabelOnly(_req: MedusaRequest, res: MedusaResponse, _next: MedusaNextFunction) {
  res.status(400).json({
    type: "not_allowed",
    message: "Courier labels are booked from the order, and cancelled by Shipbubble",
  })
}
