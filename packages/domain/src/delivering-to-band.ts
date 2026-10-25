import { addressLines } from "./saved-address"
import type { SavedAddress } from "./saved-address"

/** What tapping "Delivering to" does: nothing yet, switch addresses, ask to sign in, reload, or ask for a first address. */
export type DeliveringToAction = "none" | "choose" | "signIn" | "retry" | "addAddress"

/** "Delivering to" on Home's band: what it says, what tapping it does, and whether it is muted while loading. */
export type DeliveringToBand = {
  label: string
  action: DeliveringToAction
  /** Muted while the address is worked out, in the loaded band's shape (catalogue skeleton rules). */
  muted: boolean
  /** Whether it shows the chevron of a choice. */
  chooses: boolean
}

export type DeliveringToBandState = {
  /** The address shops are measured from: undefined while worked out, null for none. */
  address: SavedAddress | null | undefined
  signedIn: boolean
  /** The buyer's saved addresses: undefined for a guest, while they load or when they won't load. */
  saved: readonly SavedAddress[] | undefined
  /** Whether the signed-in buyer's saved addresses won't load. */
  error: boolean
}

/**
 * The band's "Delivering to" (#43, #101): the address's place, or, without one, what to do about
 * it. While the address is worked out it says so, muted, rather than showing an empty band.
 */
export function deliveringToBand({ address, signedIn, saved, error }: DeliveringToBandState): DeliveringToBand {
  if (address) return { label: addressLines(address).place, action: "choose", muted: false, chooses: true }
  if (address === undefined) return { label: "Finding your address…", action: "none", muted: true, chooses: false }
  if (!signedIn) return { label: "Sign in to see shops near you", action: "signIn", muted: false, chooses: false }
  if (error || !saved) return { label: "Couldn't load your addresses. Tap to retry", action: "retry", muted: false, chooses: false }
  if (!saved.length) return { label: "Add a delivery address", action: "addAddress", muted: false, chooses: true }
  return { label: "Choose a delivery address", action: "choose", muted: false, chooses: true }
}
