import { validateAndTransformBody, validateAndTransformQuery } from "@medusajs/framework/http"
import type { PolicedRoute } from "../../policed-route"
import { MAY_CREATE_OFFERS, MAY_PRICE_OFFERS } from "./permissions"
import { VendorGetOfferCosts, VendorPreviewOfferImport, VendorRunOfferImport } from "./validators"

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
