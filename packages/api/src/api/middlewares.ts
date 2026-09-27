import { defineMiddlewares } from "@medusajs/medusa";
import { validateAndTransformQuery } from "@medusajs/framework/http";
import { StoreGetListingParams, StoreGetListingsParams } from "./store/listings/validators";

export default defineMiddlewares({
    routes: [
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
