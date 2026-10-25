import type { GuestSpot } from "./guest-spot"
import type { SavedAddress } from "./saved-address"

/**
 * What a viewer chose since the app started: put it off ("Enter it later", "Not now", or a way on
 * was chosen), or asked for it again from the band or Home's empty state. `by` is the signed-in
 * buyer's id, or null for a guest.
 */
export type AddressPromptChoice = { by: string | null; shown: boolean }

export type AddressPromptState = {
  /** The signed-in buyer; null for a guest; undefined until Clerk has loaded. */
  userId: string | null | undefined
  /** The buyer's saved addresses: undefined for a guest, while they load or when they won't load. */
  saved: readonly SavedAddress[] | undefined
  /** The guest's spot (ADR 0015): undefined while it is read from the device, null when there is none. */
  spot: GuestSpot | null | undefined
  /** What the last viewer chose since the app started; it counts only for that viewer. */
  choice: AddressPromptChoice | null
}

/**
 * Whether "Where should we deliver?" shows: on every app start for a signed-in buyer with no
 * saved address (#101), and for a guest with no spot (#109), until they put it off for the
 * session. The band and Home's empty state ask for it again.
 */
export function addressPromptShown({ userId, saved, spot, choice }: AddressPromptState): boolean {
  if (userId === undefined) return false
  if (choice && choice.by === userId) return choice.shown
  return userId ? saved?.length === 0 : spot === null
}
