import { validateAndTransformBody } from "@medusajs/framework/http"
import type { PolicedRoute } from "../../policed-route"
import { PolicyOperation } from "@medusajs/framework/utils"
import { VendorSetCollectionPoint } from "./validators"

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
