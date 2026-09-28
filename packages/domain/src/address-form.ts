import { getAddressConfig, type AddressFieldKey } from "./address"
import { toE164 } from "./phone"

/** What the buyer typed, per field of the country's form. */
export type AddressFormValues = Partial<Record<AddressFieldKey, string>>

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
  metadata: Record<string, string>
}

export type AddressFormResult =
  | { ok: true; address: DeliveryAddress }
  | { ok: false; errors: Partial<Record<AddressFieldKey, string>> }

const METADATA_PREFIX = "metadata."

/** "Street address" reads as "street address" mid-sentence; "LGA" stays as it is. */
const inSentence = (label: string) => (/^.[a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label)

/**
 * Checks a filled address form against the country's config (`getAddressConfig`) and turns it
 * into a delivery address, or names what each wrong field needs.
 */
export function addressFromForm(values: AddressFormValues, countryCode: string): AddressFormResult {
  const config = getAddressConfig(countryCode)
  const errors: Partial<Record<AddressFieldKey, string>> = {}
  const address: Record<string, string | null> = {}
  const metadata: Record<string, string> = {}

  for (const field of config.fields) {
    const value = values[field.key]?.trim() ?? ""
    if (!value) {
      if (field.required) {
        errors[field.key] = field.options ? `Choose a ${inSentence(field.label)}` : `Enter the ${inSentence(field.label)}`
      }
    } else if (field.options && !field.options.includes(value)) {
      errors[field.key] = `Choose a ${inSentence(field.label)}`
    } else if (field.key === "phone" && !toE164(value, countryCode)) {
      errors[field.key] = `Enter a phone number like ${config.phone.placeholder}`
    }

    if (field.key.startsWith(METADATA_PREFIX)) {
      if (value) metadata[field.key.slice(METADATA_PREFIX.length)] = value
    } else {
      address[field.key] = field.key === "phone" ? toE164(value, countryCode) : value || null
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors }
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
  address: (Partial<Omit<DeliveryAddress, "metadata">> & { metadata?: Record<string, unknown> | null }) | null | undefined,
  countryCode: string,
  name?: { first_name?: string | null; last_name?: string | null }
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
