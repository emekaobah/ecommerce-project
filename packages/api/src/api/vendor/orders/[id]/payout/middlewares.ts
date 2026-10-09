import type { MiddlewareRoute } from "@medusajs/framework/http"
import { PolicyOperation } from "@medusajs/framework/utils"

// Medusa checks a route's RBAC policies (as Mercur's own vendor routes declare
// them), though its public route type leaves the field out.
type PolicedRoute = MiddlewareRoute & { policies: { resource: string; operation: string }[] }

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
