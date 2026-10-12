import { PolicyOperation } from "@medusajs/framework/utils"
import type { PolicedRoute } from "../../policed-route"

// The orders waiting at the counter are for every member who works on orders (#12), as Mercur's
// /vendor/orders is.
export const vendorReadyForPickupMiddlewares: PolicedRoute[] = [
  {
    method: ["GET"],
    matcher: "/vendor/ready-for-pickup",
    middlewares: [],
    policies: [{ resource: "order", operation: PolicyOperation.read }],
  },
]
