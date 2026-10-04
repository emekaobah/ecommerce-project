import { defineMiddlewares } from "@medusajs/medusa";
import { authenticate, validateAndTransformBody, validateAndTransformQuery } from "@medusajs/framework/http";
import { clerkCustomerAuth } from "./store/clerk-customer-auth";
import { StoreGetListingParams, StoreGetListingsParams, StoreGetShopParams } from "./store/listings/validators";
import { StoreMergeCart } from "./store/carts/[id]/merge/validators";
import { AdminPreviewCatalogueImport, AdminRunCatalogueImport } from "./admin/catalogue-import/validators";
import { AdminListEnrichments } from "./admin/catalogue-enrichment/validators";
import { StoreChooseDelivery, StorePrepareCheckout, StoreStartCheckoutPayment } from "./store/carts/[id]/checkout/validators";
import { deliveryChosenAtCheckout } from "./store/carts/[id]/checkout/delivery-by-checkout";
import { verifyPaystackSignature } from "./hooks/paystack-signature";
import { refuseVendorCapture } from "./vendor/payments/no-capture";
import { showTheShopItsOwnOrder } from "./vendor/orders/shop-view";
import { VendorRejectOrder } from "./vendor/orders/validators";
import { showTheShopItsOwnPayment } from "./vendor/payments/shop-view";
import { paystackCartsCompleteByWebhook } from "./store/carts/[id]/checkout/webhook-completes";
import { StoreCreateWishlist, StoreGetWishlist, StoreMoveWishlistToCart } from "./store/wishlist/validators";
import { vendorOfferImportMiddlewares } from "./vendor/offer-import/middlewares";
import { StoreGetOrderHistory } from "./store/order-history/validators";

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
        // Guests are answered too (no estimate), so the product page asks the same way for everyone.
        {
            method: ["GET"],
            matcher: "/store/listings/:seller_id/:product_id/delivery-estimate",
            middlewares: [
                authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true }),
                validateAndTransformQuery(StoreGetListingParams, {}),
            ],
        },
        {
            method: ["GET"],
            matcher: "/store/shops/:seller_id",
            middlewares: [validateAndTransformQuery(StoreGetShopParams, {})],
        },
        {
            method: ["POST"],
            matcher: "/store/carts/:id/merge",
            middlewares: [authenticate("customer", ["session", "bearer"]), validateAndTransformBody(StoreMergeCart)],
        },
        {
            method: ["GET"],
            matcher: "/store/carts/:id/checkout",
            middlewares: [authenticate("customer", ["session", "bearer"])],
        },
        {
            method: ["POST"],
            matcher: "/store/carts/:id/checkout",
            middlewares: [authenticate("customer", ["session", "bearer"]), validateAndTransformBody(StorePrepareCheckout)],
        },
        {
            method: ["POST"],
            matcher: "/store/carts/:id/checkout/delivery",
            middlewares: [authenticate("customer", ["session", "bearer"]), validateAndTransformBody(StoreChooseDelivery)],
        },
        { method: ["POST"], matcher: "/store/carts/:id/shipping-methods", middlewares: [deliveryChosenAtCheckout] },
        {
            method: ["POST"],
            matcher: "/store/carts/:id/checkout/payment",
            middlewares: [authenticate("customer", ["session", "bearer"]), validateAndTransformBody(StoreStartCheckoutPayment)],
        },
        // Saving to the wishlist needs an account; the app asks a guest to sign in.
        {
            method: ["GET"],
            matcher: "/store/wishlist",
            middlewares: [authenticate("customer", ["session", "bearer"]), validateAndTransformQuery(StoreGetWishlist, {})],
        },
        {
            method: ["POST"],
            matcher: "/store/wishlist",
            middlewares: [authenticate("customer", ["session", "bearer"]), validateAndTransformBody(StoreCreateWishlist)],
        },
        {
            method: ["DELETE"],
            matcher: "/store/wishlist/product/:reference_id",
            middlewares: [authenticate("customer", ["session", "bearer"])],
        },
        {
            method: ["POST"],
            matcher: "/store/wishlist/product/:reference_id/cart",
            middlewares: [authenticate("customer", ["session", "bearer"]), validateAndTransformBody(StoreMoveWishlistToCart)],
        },
        // The buyer's own order groups, with each shop's order as the buyer sees it (#17).
        {
            method: ["GET"],
            matcher: "/store/order-history",
            middlewares: [authenticate("customer", ["session", "bearer"]), validateAndTransformQuery(StoreGetOrderHistory, {})],
        },
        {
            method: ["GET"],
            matcher: "/store/order-history/:id",
            middlewares: [authenticate("customer", ["session", "bearer"])],
        },
        { method: ["POST"], matcher: "/store/carts/:id/complete", middlewares: [paystackCartsCompleteByWebhook] },
        // Paystack signs the raw body, so it is kept for the check.
        {
            method: ["POST"],
            matcher: "/hooks/payment/paystack_paystack",
            bodyParser: { preserveRawBody: true },
            middlewares: [verifyPaystackSignature],
        },
        { method: ["POST"], matcher: "/vendor/payments/:id/capture", middlewares: [refuseVendorCapture] },
        {
            method: ["POST"],
            matcher: "/vendor/orders/:id/reject",
            middlewares: [validateAndTransformBody(VendorRejectOrder)],
        },
        { matcher: "/vendor/orders*", middlewares: [showTheShopItsOwnOrder] },
        { matcher: "/vendor/payments*", middlewares: [showTheShopItsOwnPayment] },
        // Catalogue sheets arrive as CSV text in the body, up to MAX_IMPORT_ROWS rows (lib/catalogue-import/sheet).
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
        // A shop's own product list, imported as offers and proposals, and its private cost prices (#37).
        ...vendorOfferImportMiddlewares,
        {
            method: ["GET"],
            matcher: "/admin/catalogue-enrichment",
            middlewares: [validateAndTransformQuery(AdminListEnrichments, {})],
        },
    ],
});
