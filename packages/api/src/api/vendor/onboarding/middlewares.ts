import { validateAndTransformBody, type MiddlewareRoute } from "@medusajs/framework/http"
import { PolicyOperation } from "@medusajs/framework/utils"
import { VendorSaveBankAccount, VendorSavePickupAddress } from "./validators"

// Medusa checks a route's RBAC policies (as Mercur's own vendor routes declare
// them), though its public route type leaves the field out.
type PolicedRoute = MiddlewareRoute & { policies: { resource: string; operation: string }[] }

// Every member sees what is missing; only those who may change the shop (owners and managers,
// not fulfilment staff) enter its pickup address or the account it is paid into (#26).
const MAY_READ_SHOP = [{ resource: "seller", operation: PolicyOperation.read }]
const MAY_CHANGE_SHOP = [{ resource: "seller", operation: PolicyOperation.update }]

export const vendorOnboardingMiddlewares: PolicedRoute[] = [
  { method: ["GET"], matcher: "/vendor/onboarding", middlewares: [], policies: MAY_READ_SHOP },
  { method: ["GET"], matcher: "/vendor/onboarding/banks", middlewares: [], policies: MAY_CHANGE_SHOP },
  {
    method: ["POST"],
    matcher: "/vendor/onboarding/pickup-address",
    middlewares: [validateAndTransformBody(VendorSavePickupAddress)],
    policies: MAY_CHANGE_SHOP,
  },
  {
    method: ["POST"],
    matcher: "/vendor/onboarding/bank-account",
    middlewares: [validateAndTransformBody(VendorSaveBankAccount)],
    policies: MAY_CHANGE_SHOP,
  },
]
