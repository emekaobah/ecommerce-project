import { validateAndTransformBody, validateAndTransformQuery, type MiddlewareRoute } from "@medusajs/framework/http"
import { PolicyOperation } from "@medusajs/framework/utils"
import { VendorGetOfferCosts, VendorPreviewOfferImport, VendorRunOfferImport } from "./validators"

// Medusa checks a route's RBAC policies (as Mercur's own vendor routes declare
// them), though its public route type leaves the field out.
type PolicedRoute = MiddlewareRoute & { policies: { resource: string; operation: string }[] }

// A shop's import creates offers, so it needs the role that may create them:
// fulfilment staff are refused. Cost prices are for those who may price offers:
// owners and managers (#37).
const MAY_CREATE_OFFERS = [{ resource: "offer", operation: PolicyOperation.create }]
const MAY_PRICE_OFFERS = [{ resource: "offer", operation: PolicyOperation.update }]

export const vendorOfferImportMiddlewares: PolicedRoute[] = [
  { method: ["GET"], matcher: "/vendor/offer-import", middlewares: [], policies: MAY_CREATE_OFFERS },
  // A shop's product list arrives as CSV text, up to MAX_IMPORT_ROWS rows.
  {
    method: ["POST"],
    matcher: "/vendor/offer-import",
    bodyParser: { sizeLimit: "5mb" },
    middlewares: [validateAndTransformBody(VendorRunOfferImport)],
    policies: MAY_CREATE_OFFERS,
  },
  {
    method: ["POST"],
    matcher: "/vendor/offer-import/preview",
    bodyParser: { sizeLimit: "5mb" },
    middlewares: [validateAndTransformBody(VendorPreviewOfferImport)],
    policies: MAY_CREATE_OFFERS,
  },
  {
    method: ["GET"],
    matcher: "/vendor/offer-costs",
    middlewares: [validateAndTransformQuery(VendorGetOfferCosts, {})],
    policies: MAY_PRICE_OFFERS,
  },
]
