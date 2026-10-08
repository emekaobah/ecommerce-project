import { Module } from "@medusajs/framework/utils"
import ShopHoursModuleService from "./service"

export const SHOP_HOURS_MODULE = "shopHours"
export { ShopHoursModuleService }

export default Module(SHOP_HOURS_MODULE, {
  service: ShopHoursModuleService,
})
