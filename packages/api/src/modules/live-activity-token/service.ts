import { MedusaService } from "@medusajs/framework/utils"
import BuyerLiveUpdate from "./models/buyer-live-update"
import LiveActivity from "./models/live-activity"
import LiveActivityDevice from "./models/live-activity-device"
import LiveActivityShop from "./models/live-activity-shop"

class LiveActivityTokenModuleService extends MedusaService({ LiveActivityDevice, LiveActivity, LiveActivityShop, BuyerLiveUpdate }) {}

export default LiveActivityTokenModuleService
