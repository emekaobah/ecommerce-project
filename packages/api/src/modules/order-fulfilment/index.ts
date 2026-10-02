import { Module } from "@medusajs/framework/utils"
import OrderFulfilmentModuleService from "./service"

export const ORDER_FULFILMENT_MODULE = "orderFulfilment"
export { OrderFulfilmentModuleService }

export default Module(ORDER_FULFILMENT_MODULE, {
  service: OrderFulfilmentModuleService,
})
