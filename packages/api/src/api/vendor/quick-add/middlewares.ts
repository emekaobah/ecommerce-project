import { validateAndTransformBody, validateAndTransformQuery, type MiddlewareRoute } from "@medusajs/framework/http"
import { PolicyOperation } from "@medusajs/framework/utils"
import { requireQuickAdd } from "./permissions"
import { VendorGetOfferAuthors, VendorQuickAdd } from "./validators"

// Medusa checks a route's RBAC policies (as Mercur's own vendor routes declare
// them), though its public route type leaves the field out.
type MaybePolicedRoute = MiddlewareRoute & { policies?: { resource: string; operation: string }[] }

// Quick-add carries no RBAC policy: its permission check is custom (permissions.ts, ADR 0006).
export const vendorQuickAddMiddlewares: MaybePolicedRoute[] = [
  { method: ["GET"], matcher: "/vendor/quick-add/:barcode", middlewares: [requireQuickAdd] },
  // The photo arrives base64-encoded in the body: up to 10 MB, a third more as text.
  {
    method: ["POST"],
    matcher: "/vendor/quick-add",
    bodyParser: { sizeLimit: "15mb" },
    middlewares: [requireQuickAdd, validateAndTransformBody(VendorQuickAdd)],
  },
  // Who added the shop's offers: for whoever may read them.
  {
    method: ["GET"],
    matcher: "/vendor/offer-authors",
    middlewares: [validateAndTransformQuery(VendorGetOfferAuthors, {})],
    policies: [{ resource: "offer", operation: PolicyOperation.read }],
  },
]
