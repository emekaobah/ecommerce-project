import { MedusaService } from "@medusajs/framework/utils"
import PerishableCategory from "./models/perishable-category"
import PerishableProduct from "./models/perishable-product"

class PerishableModuleService extends MedusaService({ PerishableCategory, PerishableProduct }) {}

export default PerishableModuleService
