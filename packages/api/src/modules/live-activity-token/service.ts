import { MedusaService } from "@medusajs/framework/utils"
import LiveActivity from "./models/live-activity"
import LiveActivityDevice from "./models/live-activity-device"
import LiveActivityShop from "./models/live-activity-shop"

class LiveActivityTokenModuleService extends MedusaService({ LiveActivityDevice, LiveActivity, LiveActivityShop }) {}

export default LiveActivityTokenModuleService
