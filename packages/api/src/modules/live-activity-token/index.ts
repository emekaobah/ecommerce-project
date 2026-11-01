import { Module } from "@medusajs/framework/utils"
import LiveActivityTokenModuleService from "./service"

export const LIVE_ACTIVITY_TOKEN_MODULE = "liveActivityToken"
export { LiveActivityTokenModuleService }
export { APNS_ENVIRONMENTS, LIVE_ACTIVITY_ACTORS, LIVE_ACTIVITY_APPS, LIVE_ACTIVITY_KINDS } from "./models/constants"

export default Module(LIVE_ACTIVITY_TOKEN_MODULE, {
  service: LiveActivityTokenModuleService,
})
