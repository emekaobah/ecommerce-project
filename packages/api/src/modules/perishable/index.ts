import { Module } from "@medusajs/framework/utils"
import PerishableModuleService from "./service"

export const PERISHABLE_MODULE = "perishable"
export { PerishableModuleService }

export default Module(PERISHABLE_MODULE, {
  service: PerishableModuleService,
})
