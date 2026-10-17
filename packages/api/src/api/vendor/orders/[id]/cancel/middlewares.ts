import { validateAndTransformBody } from "@medusajs/framework/http"
import { PolicyOperation } from "@medusajs/framework/utils"
import { CancelOrderBody } from "../../../../cancel-order"
import type { PolicedRoute } from "../../../../policed-route"

// Cancelling an accepted order (#17) is for the shop's owners and managers (seller update,
// `role_seller_administration`), as pausing the shop is (ADR 0004). Fulfilment staff mark items
// unavailable but can't cancel: Mercur's own order-update policy on this path lets them through.
const MAY_CANCEL = [{ resource: "seller", operation: PolicyOperation.update }]

export const vendorCancelOrderMiddlewares: PolicedRoute[] = [
  { method: ["GET"], matcher: "/vendor/orders/:id/cancel", middlewares: [], policies: MAY_CANCEL },
  {
    method: ["POST"],
    matcher: "/vendor/orders/:id/cancel",
    middlewares: [validateAndTransformBody(CancelOrderBody)],
    policies: MAY_CANCEL,
  },
]
