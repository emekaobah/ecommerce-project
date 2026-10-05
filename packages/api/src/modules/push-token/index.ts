import { Module } from "@medusajs/framework/utils"
import PushTokenModuleService from "./service"

export const PUSH_TOKEN_MODULE = "pushToken"
export { PushTokenModuleService }
export { PUSH_TOKEN_ACTORS, type PushTokenActor } from "./models/push-token"

export default Module(PUSH_TOKEN_MODULE, {
  service: PushTokenModuleService,
})
