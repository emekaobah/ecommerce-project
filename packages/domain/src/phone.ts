import { getAddressConfig } from "./address"

/**
 * Normalises a phone number as a person typed it into E.164 (e.g. "+2348031234567"),
 * using the country's phone config. Returns null when it can't be a valid number.
 */
export function toE164(input: string, countryCode: string): string | null {
  const { callingCode, nationalLength, trunkPrefix } = getAddressConfig(countryCode).phone
  const country = callingCode.slice(1)
  let digits = input.replace(/\D/g, "")

  if (digits.startsWith(country) && digits.length === country.length + nationalLength) {
    digits = digits.slice(country.length)
  } else if (digits.startsWith(trunkPrefix) && digits.length === trunkPrefix.length + nationalLength) {
    digits = digits.slice(trunkPrefix.length)
  }

  const valid = digits.length === nationalLength && !digits.startsWith(trunkPrefix)
  return valid ? `${callingCode}${digits}` : null
}
