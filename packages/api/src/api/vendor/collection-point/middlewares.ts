import { validateAndTransformBody, type MiddlewareRoute } from "@medusajs/framework/http"
import { PolicyOperation } from "@medusajs/framework/utils"
import { VendorSetCollectionPoint } from "./validators"

// Medusa checks a route's RBAC policies (as Mercur's own vendor routes declare
// them), though its public route type leaves the field out.
type PolicedRoute = MiddlewareRoute & { policies: { resource: string; operation: string }[] }

// Every member sees where buyers collect; only owners and managers (seller update) set it (#12).
const MAY_READ_SHOP = [{ resource: "seller", operation: PolicyOperation.read }]
const MAY_CHANGE_SHOP = [{ resource: "seller", operation: PolicyOperation.update }]

export const vendorCollectionPointMiddlewares: PolicedRoute[] = [
  { method: ["GET"], matcher: "/vendor/collection-point", middlewares: [], policies: MAY_READ_SHOP },
  {
    method: ["POST"],
    matcher: "/vendor/collection-point",
    middlewares: [validateAndTransformBody(VendorSetCollectionPoint)],
    policies: MAY_CHANGE_SHOP,
  },
]
