import { MedusaService } from "@medusajs/framework/utils"
import OrderFulfilment from "./models/order-fulfilment"
import ShopPayout from "./models/shop-payout"
import OrderRefund from "./models/order-refund"

class OrderFulfilmentModuleService extends MedusaService({ OrderFulfilment, OrderRefund, ShopPayout }) {}

export default OrderFulfilmentModuleService
