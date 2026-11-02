import { Module } from "@medusajs/framework/utils"
import LiveActivityPushModuleService from "./service"

export const LIVE_ACTIVITY_PUSH_MODULE = "liveActivityPush"
export { LiveActivityPushModuleService }
export type {
  ApnsEnvironment,
  LiveActivityAlert,
  LiveActivityApp,
  LiveActivityPush,
  LiveActivityPushOptions,
  LiveActivityPushResult,
} from "./service"

export default Module(LIVE_ACTIVITY_PUSH_MODULE, {
  service: LiveActivityPushModuleService,
})
