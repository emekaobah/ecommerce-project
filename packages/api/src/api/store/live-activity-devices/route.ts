import { registerDevice } from "../../live-activity-tokens"

/** Gives the signed-in buyer's phone its key. */
export const POST = registerDevice("buyer", "customer")
