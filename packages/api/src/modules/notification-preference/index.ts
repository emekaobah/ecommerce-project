import { Module } from "@medusajs/framework/utils"
import NotificationPreferenceModuleService from "./service"

export const NOTIFICATION_PREFERENCE_MODULE = "notificationPreference"
export { NotificationPreferenceModuleService }

export default Module(NOTIFICATION_PREFERENCE_MODULE, {
  service: NotificationPreferenceModuleService,
})
