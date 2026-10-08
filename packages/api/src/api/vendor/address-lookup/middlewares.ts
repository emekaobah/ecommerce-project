import { validateAndTransformQuery, type MiddlewareRoute } from "@medusajs/framework/http"
import { PolicyOperation } from "@medusajs/framework/utils"
import { VendorGetPlaceAddress, VendorReverseGeocode, VendorSuggestAddresses } from "./validators"

// Medusa checks a route's RBAC policies (as Mercur's own vendor routes declare
// them), though its public route type leaves the field out.
type PolicedRoute = MiddlewareRoute & { policies: { resource: string; operation: string }[] }

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
