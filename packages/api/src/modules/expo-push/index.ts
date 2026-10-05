import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { ExpoPushNotificationProviderService } from "./service"

/** The notification channel Expo push sends on. */
export const PUSH_CHANNEL = "push"

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [ExpoPushNotificationProviderService],
})
