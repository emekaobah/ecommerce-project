import { defineMiddlewares } from "@medusajs/medusa";
import { authenticate, validateAndTransformBody, validateAndTransformQuery } from "@medusajs/framework/http";
import { clerkCustomerAuth } from "./store/clerk-customer-auth";
import { StoreGetListingParams, StoreGetListingsParams } from "./store/listings/validators";
import { StoreMergeCart } from "./store/carts/[id]/merge/validators";
import { AdminPreviewCatalogueImport, AdminRunCatalogueImport } from "./admin/catalogue-import/validators";
import { AdminListEnrichments } from "./admin/catalogue-enrichment/validators";

export default defineMiddlewares({
    routes: [
        // Before any store route's own auth check, so a Clerk session token reads as the customer.
        { matcher: "/store/*", middlewares: [clerkCustomerAuth] },
        {
            method: ["GET"],
            matcher: "/store/listings",
            middlewares: [validateAndTransformQuery(StoreGetListingsParams, {})],
        },
        {
            method: ["GET"],
            matcher: "/store/listings/:seller_id/:product_id",
            middlewares: [validateAndTransformQuery(StoreGetListingParams, {})],
        },
        {
            method: ["POST"],
            matcher: "/store/carts/:id/merge",
            middlewares: [authenticate("customer", ["session", "bearer"]), validateAndTransformBody(StoreMergeCart)],
        },
        // Catalogue sheets arrive as CSV text in the body, up to MAX_IMPORT_ROWS rows.
        {
            method: ["POST"],
            matcher: "/admin/catalogue-import",
            bodyParser: { sizeLimit: "5mb" },
            middlewares: [validateAndTransformBody(AdminRunCatalogueImport)],
        },
        {
            method: ["POST"],
            matcher: "/admin/catalogue-import/preview",
            bodyParser: { sizeLimit: "5mb" },
            middlewares: [validateAndTransformBody(AdminPreviewCatalogueImport)],
        },
        {
            method: ["GET"],
            matcher: "/admin/catalogue-enrichment",
            middlewares: [validateAndTransformQuery(AdminListEnrichments, {})],
        },
    ],
});
