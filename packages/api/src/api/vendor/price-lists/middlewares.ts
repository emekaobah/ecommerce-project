import type { MiddlewareRoute } from "@medusajs/framework/http"
import { salePricesOnOwnOffersOnly } from "./own-offers-only"

// Mercur's routes and their policies stay; a shop's sale prices are kept to its own offers (#10).
export const vendorPriceListMiddlewares: MiddlewareRoute[] = [
  "/vendor/price-lists",
  "/vendor/price-lists/:id",
  "/vendor/price-lists/:id/products",
  "/vendor/price-lists/:id/prices/batch",
].map((matcher) => ({ method: ["POST"], matcher, middlewares: [salePricesOnOwnOffersOnly] }))
