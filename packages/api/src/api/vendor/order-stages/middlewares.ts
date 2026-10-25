import { validateAndTransformQuery } from "@medusajs/framework/http"
import { PolicyOperation } from "@medusajs/framework/utils"
import { vendorOrderQueryConfig } from "@mercurjs/core/api/vendor/orders/query-config"
import type { PolicedRoute } from "../../policed-route"
import { showTheShopItsStageOrders } from "../orders/shop-view"
import { VendorGetStageOrders } from "./validators"

// The stage tiles are for every member who works on orders (#69), as Mercur's /vendor/orders is.
const readOrders = [{ resource: "order", operation: PolicyOperation.read }]

export const vendorOrderStagesMiddlewares: PolicedRoute[] = [
  { method: ["GET"], matcher: "/vendor/order-stages", middlewares: [], policies: readOrders },
  {
    method: ["GET"],
    matcher: "/vendor/order-stages/:stage",
    // Each order is shown as the shop sees it on /vendor/orders: its own share, with its fulfilment.
    middlewares: [validateAndTransformQuery(VendorGetStageOrders, vendorOrderQueryConfig.list), showTheShopItsStageOrders],
    policies: readOrders,
  },
]
