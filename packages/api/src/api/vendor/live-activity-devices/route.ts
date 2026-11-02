import { registerDevice } from "../../live-activity-tokens"

/** Gives the signed-in member's phone its key. */
export const POST = registerDevice("vendor", "member")
