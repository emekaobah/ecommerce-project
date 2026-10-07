import { Module } from "@medusajs/framework/utils"
import ShopBankAccountModuleService from "./service"

export const SHOP_BANK_ACCOUNT_MODULE = "shopBankAccount"
export { ShopBankAccountModuleService }

export default Module(SHOP_BANK_ACCOUNT_MODULE, {
  service: ShopBankAccountModuleService,
})
