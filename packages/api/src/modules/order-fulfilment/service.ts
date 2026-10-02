import { MedusaService } from "@medusajs/framework/utils"
import OrderFulfilment from "./models/order-fulfilment"
import OrderRefund from "./models/order-refund"

class OrderFulfilmentModuleService extends MedusaService({ OrderFulfilment, OrderRefund }) {}

export default OrderFulfilmentModuleService
