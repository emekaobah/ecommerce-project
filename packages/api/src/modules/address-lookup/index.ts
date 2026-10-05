import { Module } from "@medusajs/framework/utils"
import AddressLookupModuleService from "./service"

export const ADDRESS_LOOKUP_MODULE = "addressLookup"
export { AddressLookupModuleService }
export { ESSENTIALS_FIELD_MASK } from "./google"
export type { AddressLookupProvider, AddressSuggestion } from "./provider"

export default Module(ADDRESS_LOOKUP_MODULE, {
  service: AddressLookupModuleService,
})
