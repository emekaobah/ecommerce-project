import { validateAndTransformBody, type MiddlewareRoute } from "@medusajs/framework/http"
import { PolicyOperation } from "@medusajs/framework/utils"
import { VendorCreateHoursException, VendorPauseShop, VendorSetWeeklyHours } from "./validators"

// Medusa checks a route's RBAC policies (as Mercur's own vendor routes declare
// them), though its public route type leaves the field out.
type PolicedRoute = MiddlewareRoute & { policies: { resource: string; operation: string }[] }

// Every member sees the hours and whether the shop is paused; only owners and managers (seller
// update, `role_seller_administration`) change them or pause (ADR 0004).
const MAY_READ_SHOP = [{ resource: "seller", operation: PolicyOperation.read }]
const MAY_CHANGE_SHOP = [{ resource: "seller", operation: PolicyOperation.update }]

export const vendorShopHoursMiddlewares: PolicedRoute[] = [
  { method: ["GET"], matcher: "/vendor/shop-hours", middlewares: [], policies: MAY_READ_SHOP },
  {
    method: ["POST"],
    matcher: "/vendor/shop-hours/weekly",
    middlewares: [validateAndTransformBody(VendorSetWeeklyHours)],
    policies: MAY_CHANGE_SHOP,
  },
  {
    method: ["POST"],
    matcher: "/vendor/shop-hours/exceptions",
    middlewares: [validateAndTransformBody(VendorCreateHoursException)],
    policies: MAY_CHANGE_SHOP,
  },
  { method: ["DELETE"], matcher: "/vendor/shop-hours/exceptions/:id", middlewares: [], policies: MAY_CHANGE_SHOP },
  {
    method: ["POST"],
    matcher: "/vendor/shop-hours/pause",
    middlewares: [validateAndTransformBody(VendorPauseShop)],
    policies: MAY_CHANGE_SHOP,
  },
  { method: ["POST"], matcher: "/vendor/shop-hours/resume", middlewares: [], policies: MAY_CHANGE_SHOP },
]
