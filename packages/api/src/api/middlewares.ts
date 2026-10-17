import { defineMiddlewares } from "@medusajs/medusa";
import { authenticate, validateAndTransformBody, validateAndTransformQuery } from "@medusajs/framework/http";
import { clerkCustomerAuth } from "./store/clerk-customer-auth";
import { savedAddressesNeedPins } from "./store/customers/address-pin";
import { savedAddressesValidatedForDelivery } from "./store/customers/saved-address-delivery";
import {
    StoreGetDeliveryEstimateParams,
    StoreGetListingParams,
    StoreGetListingsParams,
    StoreGetShopParams,
} from "./store/listings/validators";
import { StoreMergeCart } from "./store/carts/[id]/merge/validators";
import { StoreMoveShopCartBack, StoreMoveShopToOwnCart } from "./store/carts/[id]/shop-cart/validators";
import { AdminPreviewCatalogueImport, AdminRunCatalogueImport } from "./admin/catalogue-import/validators";
import { AdminListEnrichments } from "./admin/catalogue-enrichment/validators";
import {
    StoreApplyPromoCode,
    StoreChooseDelivery,
    StorePrepareCheckout,
    StoreStartCheckoutPayment,
} from "./store/carts/[id]/checkout/validators";
import { promoCodesAtCheckout } from "./store/carts/[id]/checkout/promo-codes-at-checkout";
import { shopsDontDiscountDelivery } from "./vendor/promotions/shops-dont-discount-delivery";
import { deliveryChosenAtCheckout } from "./store/carts/[id]/checkout/delivery-by-checkout";
import { verifyPaystackSignature } from "./hooks/paystack-signature";
import { verifyShipbubbleSignature } from "./hooks/shipbubble-signature";
import { refuseVendorCapture } from "./vendor/payments/no-capture";
import { showTheShopItsOwnOrder } from "./vendor/orders/shop-view";
import { courierFulfilmentsByLabelOnly } from "./vendor/orders/labels-only";
import { hideBuyerPins } from "./vendor/buyer-pins";
import { VendorCollectOrder, VendorMarkUnavailable, VendorRecordPick, VendorRejectOrder } from "./vendor/orders/validators";
import { showTheShopItsOwnPayment } from "./vendor/payments/shop-view";
import { paystackCartsCompleteByWebhook } from "./store/carts/[id]/checkout/webhook-completes";
import { StoreCreateWishlist, StoreGetWishlist, StoreMoveWishlistToCart } from "./store/wishlist/validators";
import { vendorOfferImportMiddlewares } from "./vendor/offer-import/middlewares";
import { onlyLiveShops } from "./store/live-shops";
import { validatePickupAddressFirst } from "./pickup-address-check";
import { vendorOnboardingMiddlewares } from "./vendor/onboarding/middlewares";
import { vendorOrderPayoutMiddlewares } from "./vendor/orders/[id]/payout/middlewares";
import { vendorCancelOrderMiddlewares } from "./vendor/orders/[id]/cancel/middlewares";
import { AdminCancelOrder } from "./admin/orders/[id]/cancel/validators";
import { commissionOnlyInPayout } from "./vendor/orders/commission-in-payout";
import { vendorShopHoursMiddlewares } from "./vendor/shop-hours/middlewares";
import { vendorCollectionPointMiddlewares } from "./vendor/collection-point/middlewares";
import { vendorReadyForPickupMiddlewares } from "./vendor/ready-for-pickup/middlewares";
import { refuseMercurClosures } from "./no-mercur-closures";
import { vendorAddressLookupMiddlewares } from "./vendor/address-lookup/middlewares";
import { vendorQuickAddMiddlewares } from "./vendor/quick-add/middlewares";
import { StoreGetOrderHistory } from "./store/order-history/validators";
import { StoreRefundAccount } from "./store/refunds/validators";
import { StoreGetPublishedReviews } from "./store/reviews/validators";
import { AdminOverrideProductPerishable } from "./admin/products/[id]/perishable/validators";
import { AdminSetCategoryPerishable } from "./admin/product-categories/[id]/perishable/validators";
import { AdminRefundDelivery } from "./admin/orders/[id]/delivery-refund/validators";
import { AdminSettleOwedRefund } from "./admin/owed-refunds/[id]/settle/validators";
import { StoreGetPlaceAddress, StoreReverseGeocode, StoreSuggestAddresses } from "./store/address-lookup/validators";
import { PushTokenBody } from "./push-tokens";
import { reportServerErrors } from "./report-server-errors";

export default defineMiddlewares({
    // The API's own failures go to Sentry before Medusa answers them (#19).
    errorHandler: reportServerErrors(),
    routes: [
        // Before any store route's own auth check, so a Clerk session token reads as the customer.
        { matcher: "/store/*", middlewares: [clerkCustomerAuth] },
        // A shop that isn't through onboarding is hidden from Mercur's store routes (#26).
        { method: ["GET"], matcher: "/store/offers*", middlewares: [onlyLiveShops] },
        { method: ["GET"], matcher: "/store/sellers*", middlewares: [onlyLiveShops] },
        { method: ["GET"], matcher: "/store/products*", middlewares: [onlyLiveShops] },
        // Listings are for everyone; a signed-in buyer's `address_id` ranks them nearest first (ADR 0011).
        {
            method: ["GET"],
            matcher: "/store/listings",
            middlewares: [
                authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true }),
                validateAndTransformQuery(StoreGetListingsParams, {}),
            ],
        },
        {
            method: ["GET"],
            matcher: "/store/listings/:seller_id/:product_id",
            middlewares: [
                authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true }),
                validateAndTransformQuery(StoreGetListingParams, {}),
            ],
        },
        // Guests are answered too (no estimate), so the product page asks the same way for everyone.
        {
            method: ["GET"],
            matcher: "/store/listings/:seller_id/:product_id/delivery-estimate",
            middlewares: [
                authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true }),
                validateAndTransformQuery(StoreGetDeliveryEstimateParams, {}),
            ],
        },
        // Shops' and products' published reviews and ratings, for everyone (#7).
        {
            method: ["GET"],
            matcher: "/store/sellers/:id/reviews",
            middlewares: [validateAndTransformQuery(StoreGetPublishedReviews, {})],
        },
        {
            method: ["GET"],
            matcher: "/store/products/:id/reviews",
            middlewares: [validateAndTransformQuery(StoreGetPublishedReviews, {})],
        },
        {
            method: ["GET"],
            matcher: "/store/shops/:seller_id",
            middlewares: [
                authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true }),
                validateAndTransformQuery(StoreGetShopParams, {}),
            ],
        },
        {
            method: ["POST"],
            matcher: "/store/carts/:id/merge",
            middlewares: [authenticate("customer", ["session", "bearer"]), validateAndTransformBody(StoreMergeCart)],
        },
        // "Pay for this shop only" (#11): the shop's items move to a shop cart, and back.
        {
            method: ["POST"],
            matcher: "/store/carts/:id/shop-cart",
            middlewares: [authenticate("customer", ["session", "bearer"]), validateAndTransformBody(StoreMoveShopToOwnCart)],
        },
        {
            method: ["POST"],
            matcher: "/store/carts/:id/shop-cart/back",
            middlewares: [authenticate("customer", ["session", "bearer"]), validateAndTransformBody(StoreMoveShopCartBack)],
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
        // Promo codes (#6): entered at checkout, which works a shop's promotions out on its own items.
        {
            method: ["POST"],
            matcher: "/store/carts/:id/checkout/promo-codes",
            middlewares: [authenticate("customer", ["session", "bearer"]), validateAndTransformBody(StoreApplyPromoCode)],
        },
        {
            method: ["DELETE"],
            matcher: "/store/carts/:id/checkout/promo-codes/:code",
            middlewares: [authenticate("customer", ["session", "bearer"])],
        },
        { method: ["POST", "DELETE"], matcher: "/store/carts/:id/promotions", middlewares: [promoCodesAtCheckout] },
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
        // A refund that needs the buyer's bank account (#13): theirs only.
        { matcher: "/store/refunds/*", middlewares: [authenticate("customer", ["session", "bearer"])] },
        {
            method: ["POST"],
            matcher: "/store/refunds/:id/resolve-account",
            middlewares: [validateAndTransformBody(StoreRefundAccount)],
        },
        {
            method: ["POST"],
            matcher: "/store/refunds/:id/retry",
            middlewares: [validateAndTransformBody(StoreRefundAccount)],
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
        // Shipbubble signs the raw body of its shipment webhooks too (#24).
        {
            method: ["POST"],
            matcher: "/hooks/shipbubble",
            bodyParser: { preserveRawBody: true },
            middlewares: [verifyShipbubbleSignature],
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
        // A pickup order is handed over against its code (#12).
        {
            method: ["POST"],
            matcher: "/vendor/orders/:id/collect",
            middlewares: [validateAndTransformBody(VendorCollectOrder)],
        },
        // Owners and managers cancel an accepted order with a reason (#17).
        ...vendorCancelOrderMiddlewares,
        { method: ["POST"], matcher: "/vendor/orders/:id/fulfillments", middlewares: [courierFulfilmentsByLabelOnly] },
        {
            method: ["POST"],
            matcher: "/vendor/orders/:id/fulfillments/:fulfillment_id/cancel",
            middlewares: [courierFulfilmentsByLabelOnly],
        },
        {
            method: ["POST"],
            matcher: "/vendor/orders/:id/pick-list/:item_id/unavailable",
            middlewares: [validateAndTransformBody(VendorMarkUnavailable)],
        },
        { matcher: "/vendor/orders*", middlewares: [showTheShopItsOwnOrder] },
        { method: ["POST"], matcher: "/vendor/promotions", middlewares: [shopsDontDiscountDelivery] },
        { method: ["POST"], matcher: "/vendor/promotions/:id", middlewares: [shopsDontDiscountDelivery] },
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
        // Refunds of delivery (#22): Oja's staff alone, since Oja keeps the delivery fee.
        {
            method: ["POST"],
            matcher: "/admin/orders/:id/delivery-refund",
            middlewares: [validateAndTransformBody(AdminRefundDelivery)],
        },
        // Oja's staff cancel an accepted order with a reason, refunding its share alone (#17).
        {
            method: ["POST"],
            matcher: "/admin/orders/:id/cancel",
            middlewares: [validateAndTransformBody(AdminCancelOrder)],
        },
        // Oja's staff settle by hand a refund Paystack can't make (#16).
        {
            method: ["POST"],
            matcher: "/admin/owed-refunds/:id/settle",
            middlewares: [validateAndTransformBody(AdminSettleOwedRefund)],
        },
        // A shop's onboarding checklist, pickup address and bank account (#26).
        ...vendorOnboardingMiddlewares,
        ...vendorOrderPayoutMiddlewares,
        // Mercur's commission lines don't follow refunds; the payout's commission is the one shown (#23).
        { method: ["GET"], matcher: "/vendor/orders/:id/commission-lines", middlewares: [commissionOnlyInPayout] },
        // Pickup address lookup through the backend's Google key, in the shop's region (ADR 0002, #41).
        ...vendorAddressLookupMiddlewares,
        { method: ["POST"], matcher: "/vendor/sellers/:id/address", middlewares: [validatePickupAddressFirst] },
        { method: ["POST"], matcher: "/admin/sellers/:id/address", middlewares: [validatePickupAddressFirst] },
        // A shop's hours, exceptions and pause (ADR 0004, #68): the only source of truth for
        // closures, so Mercur's seller closure fields can't be written.
        ...vendorShopHoursMiddlewares,
        // Where a shop's buyers collect pickup orders (#12): owners and managers set it.
        ...vendorCollectionPointMiddlewares,
        ...vendorReadyForPickupMiddlewares,
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
