import { validateAndTransformBody } from "@medusajs/framework/http"
import type { PolicedRoute } from "../../policed-route"
import { PolicyOperation } from "@medusajs/framework/utils"
import { VendorSaveBankAccount, VendorSavePickupAddress } from "./validators"

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
