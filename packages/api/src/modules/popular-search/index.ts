import { Module } from "@medusajs/framework/utils"
import PopularSearchModuleService from "./service"

export const POPULAR_SEARCH_MODULE = "popularSearch"
export { PopularSearchModuleService }

export default Module(POPULAR_SEARCH_MODULE, {
  service: PopularSearchModuleService,
})
