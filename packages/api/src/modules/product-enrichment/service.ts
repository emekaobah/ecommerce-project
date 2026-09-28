import { MedusaService } from "@medusajs/framework/utils"
import ProductEnrichment from "./models/product-enrichment"

export default class ProductEnrichmentModuleService extends MedusaService({ ProductEnrichment }) {}
