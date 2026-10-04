import { Module } from "@medusajs/framework/utils"
import OfferImportModuleService from "./service"

export const OFFER_IMPORT_MODULE = "offerImport"
export { OfferImportModuleService }

export default Module(OFFER_IMPORT_MODULE, {
  service: OfferImportModuleService,
})
