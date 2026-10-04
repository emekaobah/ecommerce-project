import { MedusaService } from "@medusajs/framework/utils"
import OfferCost from "./models/offer-cost"
import OfferImportMapping from "./models/offer-import-mapping"

class OfferImportModuleService extends MedusaService({ OfferCost, OfferImportMapping }) {}

export default OfferImportModuleService
