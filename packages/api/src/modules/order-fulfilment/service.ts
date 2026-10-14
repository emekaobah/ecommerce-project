import { MedusaService } from "@medusajs/framework/utils"
import OrderFulfilment from "./models/order-fulfilment"
import ShopPayout from "./models/shop-payout"
import OrderRefund from "./models/order-refund"
import DiscountFunding from "./models/discount-funding"

class OrderFulfilmentModuleService extends MedusaService({ OrderFulfilment, OrderRefund, ShopPayout, DiscountFunding }) {}

export default OrderFulfilmentModuleService
