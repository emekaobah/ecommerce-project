import { validateAndTransformQuery } from "@medusajs/framework/http"
import type { PolicedRoute } from "../../policed-route"
import { PolicyOperation } from "@medusajs/framework/utils"
import { VendorGetPlaceAddress, VendorReverseGeocode, VendorSuggestAddresses } from "./validators"

// Lookups serve the pickup address form, so only members who enter it (owners and managers,
// as for the address itself in onboarding/middlewares.ts) look addresses up (#41).
const MAY_CHANGE_SHOP = [{ resource: "seller", operation: PolicyOperation.update }]

export const vendorAddressLookupMiddlewares: PolicedRoute[] = [
  {
    method: ["GET"],
    matcher: "/vendor/address-lookup/suggestions",
    middlewares: [validateAndTransformQuery(VendorSuggestAddresses, {})],
    policies: MAY_CHANGE_SHOP,
  },
  {
    method: ["GET"],
    matcher: "/vendor/address-lookup/places/:place_id",
    middlewares: [validateAndTransformQuery(VendorGetPlaceAddress, {})],
    policies: MAY_CHANGE_SHOP,
  },
  {
    method: ["GET"],
    matcher: "/vendor/address-lookup/reverse-geocode",
    middlewares: [validateAndTransformQuery(VendorReverseGeocode, {})],
    policies: MAY_CHANGE_SHOP,
  },
]
