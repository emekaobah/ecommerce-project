import { defineMiddlewares } from "@medusajs/medusa";
import { validateAndTransformQuery } from "@medusajs/framework/http";
import { clerkCustomerAuth } from "./store/clerk-customer-auth";
import { StoreGetListingParams, StoreGetListingsParams } from "./store/listings/validators";

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
    ],
});
