import { MedusaService } from "@medusajs/framework/utils"
import PopularSearch from "./models/popular-search"
import SearchRecord from "./models/search-record"

class PopularSearchModuleService extends MedusaService({ SearchRecord, PopularSearch }) {}

export default PopularSearchModuleService
