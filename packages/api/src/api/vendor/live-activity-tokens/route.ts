import { reportShopToken } from "../../vendor-live-activity"

// The phone's key is the credential, not a member's session: this may run on a background launch
// before the session is read, or on a locked phone (ADR 0018).
export const AUTHENTICATE = false

/** Takes a token from a phone with its key. */
export const POST = reportShopToken
