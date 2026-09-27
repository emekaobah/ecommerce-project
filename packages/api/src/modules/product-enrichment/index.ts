import { Module } from "@medusajs/framework/utils"
import ProductEnrichmentModuleService from "./service"

export const PRODUCT_ENRICHMENT_MODULE = "productEnrichment"

export default Module(PRODUCT_ENRICHMENT_MODULE, {
  service: ProductEnrichmentModuleService,
})
