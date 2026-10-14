import type { PolicedRoute } from "../../../../policed-route"
import { PolicyOperation } from "@medusajs/framework/utils"

// An order's payout is for the members who may see the shop's payouts, as on Mercur's
// /vendor/payouts (#29).
export const vendorOrderPayoutMiddlewares: PolicedRoute[] = [
  {
    method: ["GET"],
    matcher: "/vendor/orders/:id/payout",
    middlewares: [],
    policies: [{ resource: "payout", operation: PolicyOperation.read }],
  },
]
