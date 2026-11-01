import { MedusaService } from "@medusajs/framework/utils"
import LiveActivity from "./models/live-activity"
import LiveActivityDevice from "./models/live-activity-device"

class LiveActivityTokenModuleService extends MedusaService({ LiveActivityDevice, LiveActivity }) {}

export default LiveActivityTokenModuleService
