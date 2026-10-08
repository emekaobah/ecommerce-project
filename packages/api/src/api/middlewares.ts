import { defineMiddlewares } from "@medusajs/medusa";
import { authenticate, validateAndTransformBody, validateAndTransformQuery } from "@medusajs/framework/http";
import { clerkCustomerAuth } from "./store/clerk-customer-auth";
import { savedAddressesNeedPins } from "./store/customers/address-pin";
import { savedAddressesValidatedForDelivery } from "./store/customers/saved-address-delivery";
import { StoreGetListingParams, StoreGetListingsParams, StoreGetShopParams } from "./store/listings/validators";
import { StoreMergeCart } from "./store/carts/[id]/merge/validators";
import { AdminPreviewCatalogueImport, AdminRunCatalogueImport } from "./admin/catalogue-import/validators";
import { AdminListEnrichments } from "./admin/catalogue-enrichment/validators";
import { StoreChooseDelivery, StorePrepareCheckout, StoreStartCheckoutPayment } from "./store/carts/[id]/checkout/validators";
import { deliveryChosenAtCheckout } from "./store/carts/[id]/checkout/delivery-by-checkout";
import { verifyPaystackSignature } from "./hooks/paystack-signature";
import { refuseVendorCapture } from "./vendor/payments/no-capture";
import { showTheShopItsOwnOrder } from "./vendor/orders/shop-view";
import { hideBuyerPins } from "./vendor/buyer-pins";
import { VendorMarkUnavailable, VendorRecordPick, VendorRejectOrder } from "./vendor/orders/validators";
import { showTheShopItsOwnPayment } from "./vendor/payments/shop-view";
import { paystackCartsCompleteByWebhook } from "./store/carts/[id]/checkout/webhook-completes";
import { StoreCreateWishlist, StoreGetWishlist, StoreMoveWishlistToCart } from "./store/wishlist/validators";
import { vendorOfferImportMiddlewares } from "./vendor/offer-import/middlewares";
import { onlyLiveShops } from "./store/live-shops";
import { validatePickupAddressFirst } from "./pickup-address-check";
import { vendorOnboardingMiddlewares } from "./vendor/onboarding/middlewares";
import { vendorShopHoursMiddlewares } from "./vendor/shop-hours/middlewares";
import { refuseMercurClosures } from "./no-mercur-closures";
import { vendorAddressLookupMiddlewares } from "./vendor/address-lookup/middlewares";
import { vendorQuickAddMiddlewares } from "./vendor/quick-add/middlewares";
import { StoreGetOrderHistory } from "./store/order-history/validators";
import { AdminOverrideProductPerishable } from "./admin/products/[id]/perishable/validators";
import { AdminSetCategoryPerishable } from "./admin/product-categories/[id]/perishable/validators";
import { StoreGetPlaceAddress, StoreReverseGeocode, StoreSuggestAddresses } from "./store/address-lookup/validators";
import { PushTokenBody } from "./push-tokens";

export default defineMiddlewares({
    routes: [
        // Before any store route's own auth check, so a Clerk session token reads as the customer.
        { matcher: "/store/*", middlewares: [clerkCustomerAuth] },
        // A shop that isn't through onboarding is hidden from Mercur's store routes (#26).
        { method: ["GET"], matcher: "/store/offers*", middlewares: [onlyLiveShops] },
        { method: ["GET"], matcher: "/store/sellers*", middlewares: [onlyLiveShops] },
        { method: ["GET"], matcher: "/store/products*", middlewares: [onlyLiveShops] },
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
        // Address lookup through the backend's Google key, for signed-in buyers only (ADR 0002, #40).
        {
            method: ["GET"],
            matcher: "/store/address-lookup/suggestions",
            middlewares: [authenticate("customer", ["session", "bearer"]), validateAndTransformQuery(StoreSuggestAddresses, {})],
        },
        {
            method: ["GET"],
            matcher: "/store/address-lookup/places/:place_id",
            middlewares: [authenticate("customer", ["session", "bearer"]), validateAndTransformQuery(StoreGetPlaceAddress, {})],
        },
        {
            method: ["GET"],
            matcher: "/store/address-lookup/reverse-geocode",
            middlewares: [authenticate("customer", ["session", "bearer"]), validateAndTransformQuery(StoreReverseGeocode, {})],
        },
        // A saved delivery address carries the buyer's pin and Shipbubble's address code, like
        // every address checkout takes (#18). Deleting the default leaves another: see the route.
        {
            method: ["POST"],
            matcher: "/store/customers/me/addresses",
            middlewares: [savedAddressesNeedPins, savedAddressesValidatedForDelivery],
        },
        {
            method: ["POST"],
            matcher: "/store/customers/me/addresses/:address_id",
            middlewares: [savedAddressesNeedPins, savedAddressesValidatedForDelivery],
        },
        // A signed-in buyer's device registers for pushes, and is removed at sign-out (#27).
        {
            method: ["POST"],
            matcher: "/store/push-tokens",
            middlewares: [authenticate("customer", ["session", "bearer"]), validateAndTransformBody(PushTokenBody)],
        },
        {
            method: ["DELETE"],
            matcher: "/store/push-tokens/:token",
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
        // Shop staff never see where a buyer's pin is, whatever fields they ask for (ADR 0002).
        { matcher: "/vendor/*", middlewares: [hideBuyerPins] },
        { method: ["POST"], matcher: "/vendor/payments/:id/capture", middlewares: [refuseVendorCapture] },
        {
            method: ["POST"],
            matcher: "/vendor/orders/:id/reject",
            middlewares: [validateAndTransformBody(VendorRejectOrder)],
        },
        {
            method: ["POST"],
            matcher: "/vendor/orders/:id/pick-list/:item_id",
            middlewares: [validateAndTransformBody(VendorRecordPick)],
        },
        {
            method: ["POST"],
            matcher: "/vendor/orders/:id/pick-list/:item_id/unavailable",
            middlewares: [validateAndTransformBody(VendorMarkUnavailable)],
        },
        { matcher: "/vendor/orders*", middlewares: [showTheShopItsOwnOrder] },
        // A member's device registers for their shops' pushes (#27); Mercur authenticates the member.
        { method: ["POST"], matcher: "/vendor/push-tokens", middlewares: [validateAndTransformBody(PushTokenBody)] },
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
        // Perishable flags (#69): the operator's alone, so there are no vendor routes for them.
        {
            method: ["POST"],
            matcher: "/admin/product-categories/:id/perishable",
            middlewares: [validateAndTransformBody(AdminSetCategoryPerishable)],
        },
        {
            method: ["POST"],
            matcher: "/admin/products/:id/perishable",
            middlewares: [validateAndTransformBody(AdminOverrideProductPerishable)],
        },
        // A shop's onboarding checklist, pickup address and bank account (#26).
        ...vendorOnboardingMiddlewares,
        // Pickup address lookup through the backend's Google key, in the shop's region (ADR 0002, #41).
        ...vendorAddressLookupMiddlewares,
        { method: ["POST"], matcher: "/vendor/sellers/:id/address", middlewares: [validatePickupAddressFirst] },
        { method: ["POST"], matcher: "/admin/sellers/:id/address", middlewares: [validatePickupAddressFirst] },
        // A shop's hours, exceptions and pause (ADR 0004, #68): the only source of truth for
        // closures, so Mercur's seller closure fields can't be written.
        ...vendorShopHoursMiddlewares,
        { method: ["POST"], matcher: "/vendor/sellers/me", middlewares: [refuseMercurClosures] },
        { method: ["POST"], matcher: "/vendor/sellers/:id", middlewares: [refuseMercurClosures] },
        { method: ["POST"], matcher: "/admin/sellers", middlewares: [refuseMercurClosures] },
        { method: ["POST"], matcher: "/admin/sellers/:id", middlewares: [refuseMercurClosures] },
        // Staff scan a product the shop doesn't sell yet and add it (#38, ADR 0006).
        ...vendorQuickAddMiddlewares,
        {
            method: ["GET"],
            matcher: "/admin/catalogue-enrichment",
            middlewares: [validateAndTransformQuery(AdminListEnrichments, {})],
        },
    ],
});
