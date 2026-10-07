import { removePushToken } from "../../../push-tokens"

/** Stops pushing to the buyer's device, at sign-out. */
export const DELETE = removePushToken("customer")
