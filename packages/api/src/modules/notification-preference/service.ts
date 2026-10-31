import { MedusaService } from "@medusajs/framework/utils"
import NotificationPreference from "./models/notification-preference"

class NotificationPreferenceModuleService extends MedusaService({ NotificationPreference }) {}

export default NotificationPreferenceModuleService
