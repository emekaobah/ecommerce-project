import { getAddressConfig } from "./address"
import { addressFormValues, addressFromForm, pinOf, type PinnedDeliveryAddress, type StoredAddress } from "./address-form"
import { deliveringTo } from "./distance"

/** An address the buyer saved to their account (Medusa's customer address). */
export type SavedAddress = StoredAddress & { id: string; is_default_shipping?: boolean | null }

/** How an address reads in a list: who, where, the rider's landmark (if any) and the phone. */
export type AddressLines = { name: string; place: string; landmark: string | null; phone: string }

const filled = (parts: (string | null | undefined)[], separator: string) =>
  parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(separator)

/** The lines an address shows as, in the address list and at checkout. */
export function addressLines(address: StoredAddress): AddressLines {
  const landmark = address.metadata?.landmark
  return {
    name: filled([address.first_name, address.last_name], " "),
    place: filled([address.address_1, address.address_2, address.city, address.province], ", "),
    landmark: typeof landmark === "string" && landmark.trim() ? landmark.trim() : null,
    phone: address.phone ?? "",
  }
}

/**
 * A saved address as checkout takes it, or null when checkout can't deliver there yet: it has
 * no confirmed pin (ADR 0002), or the country's form wouldn't take it. The buyer edits it first.
 */
export function checkoutAddressOf(address: StoredAddress, countryCode: string): PinnedDeliveryAddress | null {
  const pin = pinOf(address)
  if (!pin) return null
  const result = addressFromForm(addressFormValues(address, countryCode), countryCode, pin)
  return result.ok ? result.address : null
}

/**
 * The saved address checkout starts with, when checkout can deliver there: the one the buyer
 * picked to deliver to on Home or Search (`pickedId`, #43), else their default. Without either
 * checkout asks, rather than guessing which address the buyer means.
 */
export function preselectedAddress(
  addresses: readonly SavedAddress[],
  countryCode: string,
  pickedId?: string | null
): { id: string; address: PinnedDeliveryAddress } | null {
  const id = deliveringTo(addresses, pickedId)
  const saved = addresses.find((a) => a.id === id)
  const address = saved && checkoutAddressOf(saved, countryCode)
  return saved && address ? { id: saved.id, address } : null
}

/**
 * Where checkout's delivery address stands: finding the buyer's default (`starting`), set on
 * the cart (`chosen`), choosing a saved one, or entering a new one.
 */
export type AddressStep = "starting" | "chosen" | "choosing" | "entering"

/**
 * The address step checkout follows until the buyer moves it themselves. The cart's address
 * shows once it has one checkout can quote. Before that, checkout starts with the saved address
 * the buyer picked to deliver to, else their default; without one it offers the saved ones, or
 * a new address, which is also what the buyer gets when the saved addresses won't load.
 */
export function addressStep({
  cartAddress,
  readyToPay,
  saved,
  savedFailed = false,
  picked,
  countryCode,
}: {
  cartAddress: StoredAddress | null | undefined
  readyToPay: boolean
  /** The buyer's saved addresses; undefined while they load. */
  saved: readonly SavedAddress[] | undefined
  savedFailed?: boolean
  /** The saved address picked to deliver to on Home or Search (#43). */
  picked?: string | null
  countryCode: string
}): AddressStep {
  const offerSaved = () => (saved?.length ? "choosing" : "entering")
  if (cartAddress) {
    // An address saved before pins were required can't be quoted again: the buyer places one.
    return readyToPay || checkoutAddressOf(cartAddress, countryCode) ? "chosen" : offerSaved()
  }
  if (savedFailed) return "entering"
  if (!saved || preselectedAddress(saved, countryCode, picked)) return "starting"
  return offerSaved()
}

/**
 * An edited address as the store's update takes it. The store merges an edit's metadata into
 * the saved address's and removes only a key sent empty, so a metadata field of the country's
 * form the buyer cleared (the landmark) is sent empty.
 */
export function savedAddressEdit(address: PinnedDeliveryAddress, countryCode: string): PinnedDeliveryAddress {
  const cleared: Record<string, string> = {}
  for (const { key } of getAddressConfig(countryCode).fields) {
    const name = key.startsWith("metadata.") ? key.slice("metadata.".length) : null
    if (name && !(name in address.metadata)) cleared[name] = ""
  }
  return { ...address, metadata: { ...cleared, ...address.metadata } }
}

/** The buyer's saved addresses as listed: the default first, the rest in the order they came. */
export function addressBook<A extends SavedAddress>(addresses: readonly A[]): A[] {
  return [...addresses.filter((a) => a.is_default_shipping), ...addresses.filter((a) => !a.is_default_shipping)]
}

/**
 * The cart delivers to a saved address: the same form, phone and landmark included, and the same
 * pin. One saved without a name (#101) is delivered to in whatever name checkout gave its receiver.
 */
function samePlace(saved: StoredAddress, cart: StoredAddress, countryCode: string): boolean {
  const formA: Record<string, string | undefined> = addressFormValues(saved, countryCode)
  const formB: Record<string, string | undefined> = addressFormValues(cart, countryCode)
  const pinA = pinOf(saved)
  const pinB = pinOf(cart)
  const unnamed = !formA.first_name && !formA.last_name
  return (
    Object.keys(formA).every((key) => (unnamed && NAME_KEYS.includes(key)) || formA[key] === formB[key]) &&
    !!pinA &&
    !!pinB &&
    pinA.latitude === pinB.latitude &&
    pinA.longitude === pinB.longitude
  )
}

const NAME_KEYS: readonly string[] = ["first_name", "last_name"]

/** The saved address the cart delivers to, so checkout shows it as chosen; null for one that isn't saved. */
export function savedAddressFor(
  addresses: readonly SavedAddress[],
  cartAddress: StoredAddress | null | undefined,
  countryCode: string
): string | null {
  if (!cartAddress) return null
  return addresses.find((saved) => samePlace(saved, cartAddress, countryCode))?.id ?? null
}

/** A saved address as far as which one is the default goes. */
export type DefaultCandidate = { id: string; is_default_shipping?: boolean | null; created_at: string | Date }

/**
 * The saved address that becomes the default when the buyer deletes `deletedId`: the most
 * recently added of the rest, when the one deleted was the default. Null when nothing changes:
 * another address was deleted, the default was the last one, or there was no default.
 */
export function defaultAfterDeleting(addresses: readonly DefaultCandidate[], deletedId: string): string | null {
  const deleted = addresses.find((a) => a.id === deletedId)
  if (!deleted?.is_default_shipping) return null
  const newest = addresses
    .filter((a) => a.id !== deletedId)
    .reduce<DefaultCandidate | null>(
      (latest, a) => (!latest || new Date(a.created_at).getTime() > new Date(latest.created_at).getTime() ? a : latest),
      null
    )
  return newest?.id ?? null
}
