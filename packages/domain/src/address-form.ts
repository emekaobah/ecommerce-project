import { getAddressConfig, type AddressConfig, type AddressField, type AddressFieldKey } from "./address"
import { toE164 } from "./phone"

/** What the buyer typed, per field of the country's form. */
export type AddressFormValues = Partial<Record<AddressFieldKey, string>>

/** What each wrong field of the form needs, e.g. "Enter the LGA". */
export type AddressFormErrors = Partial<Record<AddressFieldKey, string>>

/** The buyer's name, which an empty form starts with. */
export type BuyerName = { first_name?: string | null; last_name?: string | null }

/** A delivery address as the store takes it: Medusa's columns, extra fields in `metadata` (ADR 0002). */
export type DeliveryAddress = {
  first_name: string
  last_name: string
  address_1: string
  address_2?: string | null
  city: string
  province: string
  postal_code?: string | null
  country_code: string
  /** E.164, e.g. "+2348031234567". */
  phone: string
  /** `landmark`, and the pin the buyer confirmed (`latitude`, `longitude`). */
  metadata: { landmark?: string; latitude?: number; longitude?: number }
}

/**
 * An address as the store returns it, saved to the buyer's account or on a cart: Medusa's
 * columns, any of which may be empty, and `metadata` with the landmark and pin (ADR 0002).
 */
export type StoredAddress = {
  first_name?: string | null
  last_name?: string | null
  address_1?: string | null
  address_2?: string | null
  city?: string | null
  province?: string | null
  postal_code?: string | null
  country_code?: string | null
  phone?: string | null
  metadata?: Record<string, unknown> | null
}

/** A point on the map, in degrees. */
export type Pin = { latitude: number; longitude: number }

/** The pin the buyer confirmed for an address, read back from its metadata; null without a whole one. */
export function pinOf(address: { metadata?: Record<string, unknown> | null } | null | undefined): Pin | null {
  const { latitude, longitude } = address?.metadata ?? {}
  return typeof latitude === "number" && typeof longitude === "number" ? { latitude, longitude } : null
}

/** Six decimal places is about 11 cm, finer than any pin a finger places. */
const toMicroDegrees = (degrees: number) => Math.round(degrees * 1e6) / 1e6

/** A delivery address with the pin the buyer confirmed, as checkout needs it. */
export type PinnedDeliveryAddress = DeliveryAddress & { metadata: Pin & { landmark?: string } }

export type AddressFormResult<A extends DeliveryAddress = DeliveryAddress> =
  | { ok: true; address: A }
  | { ok: false; errors: AddressFormErrors }

const METADATA_PREFIX = "metadata."

/** "Street address" reads as "street address" mid-sentence; "LGA" stays as it is. */
const inSentence = (label: string) => (/^.[a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label)

/** What a field's value needs to be right, or null when it is. */
function fieldError(field: AddressField, value: string, config: AddressConfig): string | null {
  const choose = `Choose a ${inSentence(field.label)}`
  if (!value) {
    if (!field.required) return null
    return field.options ? choose : `Enter the ${inSentence(field.label)}`
  }
  if (field.options && !field.options.includes(value)) return choose
  if (field.key === "phone" && !toE164(value, config.countryCode)) {
    return `Enter a phone number like ${config.phone.placeholder}`
  }
  return null
}

/**
 * Checks a filled address form against the country's config (`getAddressConfig`) and turns it
 * into a delivery address, or names what each wrong field needs. The `pin` the buyer confirmed
 * on the map goes into its metadata (ADR 0002).
 */
export function addressFromForm(values: AddressFormValues, countryCode: string): AddressFormResult
export function addressFromForm(
  values: AddressFormValues,
  countryCode: string,
  pin: Pin
): AddressFormResult<PinnedDeliveryAddress>
export function addressFromForm(values: AddressFormValues, countryCode: string, pin?: Pin): AddressFormResult {
  const config = getAddressConfig(countryCode)
  const errors: AddressFormErrors = {}
  const address: Record<string, string | null> = {}
  const metadata: DeliveryAddress["metadata"] & Record<string, string | number> = {}

  for (const field of config.fields) {
    const value = values[field.key]?.trim() ?? ""
    const error = fieldError(field, value, config)
    if (error) errors[field.key] = error

    if (!field.key.startsWith(METADATA_PREFIX)) {
      address[field.key] = field.key === "phone" ? toE164(value, countryCode) : value || null
    } else if (value) {
      metadata[field.key.slice(METADATA_PREFIX.length)] = value
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors }
  if (pin) {
    metadata.latitude = toMicroDegrees(pin.latitude)
    metadata.longitude = toMicroDegrees(pin.longitude)
  }
  return {
    ok: true,
    address: { ...(address as Omit<DeliveryAddress, "country_code" | "metadata">), country_code: config.countryCode.toLowerCase(), metadata },
  }
}

/**
 * The form's values for a saved address (e.g. the one checkout last used), phone in the
 * national format people type; empty fields, with the buyer's name, when there is none.
 */
export function addressFormValues(
  address: StoredAddress | null | undefined,
  countryCode: string,
  name?: BuyerName
): AddressFormValues {
  const config = getAddressConfig(countryCode)
  const source: Record<string, unknown> = address ?? { first_name: name?.first_name, last_name: name?.last_name }
  const values: AddressFormValues = {}
  for (const { key } of config.fields) {
    const raw = key.startsWith(METADATA_PREFIX)
      ? (source.metadata as Record<string, unknown> | undefined)?.[key.slice(METADATA_PREFIX.length)]
      : source[key]
    values[key] = typeof raw === "string" ? raw : ""
  }
  const { callingCode, trunkPrefix } = config.phone
  if (values.phone?.startsWith(callingCode)) values.phone = trunkPrefix + values.phone.slice(callingCode.length)
  return values
}
