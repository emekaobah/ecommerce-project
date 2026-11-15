import { removeDevice } from "../../../live-activity-tokens"

/** Forgets the buyer's phone, at sign-out. */
export const DELETE = removeDevice("customer")
