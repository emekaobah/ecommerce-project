import { removePushToken } from "../../../push-tokens"

/** Stops pushing to the member's device, at sign-out. */
export const DELETE = removePushToken("member")
