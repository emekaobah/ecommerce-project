import { Module } from "@medusajs/framework/utils"
import ShopPinModuleService from "./service"

export const SHOP_PIN_MODULE = "shopPin"
export { ShopPinModuleService }

export default Module(SHOP_PIN_MODULE, {
  service: ShopPinModuleService,
})
