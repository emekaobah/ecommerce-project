import { MedusaService } from "@medusajs/framework/utils"
import ShopHoursException from "./models/shop-hours-exception"
import ShopPause from "./models/shop-pause"
import ShopWeeklyHours from "./models/shop-weekly-hours"

class ShopHoursModuleService extends MedusaService({ ShopWeeklyHours, ShopHoursException, ShopPause }) {}

export default ShopHoursModuleService
