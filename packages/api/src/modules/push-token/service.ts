import { MedusaService } from "@medusajs/framework/utils"
import PushToken from "./models/push-token"

class PushTokenModuleService extends MedusaService({ PushToken }) {}

export default PushTokenModuleService
