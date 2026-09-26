/** Medusa address columns a country's form can fill. */
type AddressColumn =
  | "first_name"
  | "last_name"
  | "address_1"
  | "address_2"
  | "city"
  | "province"
  | "postal_code"
  | "phone"

/** A Medusa address column, or a key stored in the address's `metadata` (ADR 0002). */
export type AddressFieldKey = AddressColumn | `metadata.${string}`

export type AddressField = {
  key: AddressFieldKey
  label: string
  required: boolean
  /** Example input shown in the empty field. */
  placeholder?: string
  /** A fixed list to pick from; absent means free text. */
  options?: readonly string[]
}

export type PhoneConfig = {
  /** E.164 country calling code, e.g. "+234". */
  callingCode: string
  /** Digits in the national significant number (after the calling code, without the trunk 0). */
  nationalLength: number
  /** Trunk prefix dialled before a national number, e.g. "0" in 0803 123 4567. */
  trunkPrefix: string
  placeholder: string
}

export type AddressConfig = {
  countryCode: string
  /** Fields in form order. */
  fields: readonly AddressField[]
  phone: PhoneConfig
}

const NG_STATES = [
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "Federal Capital Territory",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara",
] as const

const CONFIGS: Record<string, AddressConfig> = {
  NG: {
    countryCode: "NG",
    fields: [
      { key: "first_name", label: "First name", required: true },
      { key: "last_name", label: "Last name", required: true },
      { key: "address_1", label: "Street address", required: true },
      { key: "address_2", label: "Apartment, floor", required: false },
      {
        key: "metadata.landmark",
        label: "Landmark / directions for the rider",
        required: false,
        placeholder: "e.g. opposite the Mobil station",
      },
      // Nigerian addresses have no reliable postcode; the LGA takes the city slot.
      { key: "city", label: "LGA", required: true },
      { key: "province", label: "State", required: true, options: NG_STATES },
      { key: "phone", label: "Phone number", required: true },
    ],
    phone: { callingCode: "+234", nationalLength: 10, trunkPrefix: "0", placeholder: "0803 123 4567" },
  },
}

/** Address and phone form config for a country (ISO 3166-1 alpha-2, any case). */
export function getAddressConfig(countryCode: string): AddressConfig {
  const code = countryCode.toUpperCase()
  const config = CONFIGS[code]
  if (!config) throw new Error(`No address config for country ${code}`)
  return config
}
