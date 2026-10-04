import { getAddressConfig } from "./address"
import type { AddressFormValues } from "./address-form"

/**
 * Names an address lookup provider uses for a state that aren't on the country's list, by
 * country. Google's own names matched the NG list in the check (ADR 0002); these are variants
 * it or another provider may still send.
 */
const STATE_ALIASES: Record<string, Record<string, string>> = {
  NG: {
    abuja: "Federal Capital Territory",
    fct: "Federal Capital Territory",
    nassarawa: "Nasarawa",
  },
}

/** "Akwa-Ibom State " reads as "akwa ibom". */
const normalised = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replaceAll("-", " ")
    .replace(/\s+state$/, "")
    .replaceAll(/\s+/g, " ")

/**
 * The state on the country's list (`getAddressConfig`) a provider's state name stands for, or
 * null when it stands for none, leaving the buyer to choose.
 */
export function stateFromLookup(name: string | null | undefined, countryCode: string): string | null {
  if (!name) return null
  const config = getAddressConfig(countryCode)
  const options = config.fields.find((f) => f.key === "province")?.options ?? []
  const wanted = normalised(name)
  return options.find((option) => normalised(option) === wanted) ?? STATE_ALIASES[config.countryCode]?.[wanted] ?? null
}

/**
 * A place an address lookup provider found, in the provider's own words. `district` is the
 * area below the state (the LGA in NG); `area` the neighbourhood.
 */
export type LookedUpPlace = {
  formatted_address: string
  /** The provider's position for the place; the buyer's pin, not this, is kept (ADR 0002). */
  location: { latitude: number; longitude: number }
  /** ISO 3166-1 alpha-2. */
  country_code: string | null
  /** House number and street, e.g. "3 Akin Adesola Street". */
  street: string | null
  area: string | null
  town: string | null
  district: string | null
  state: string | null
  postal_code: string | null
}

/**
 * The address form's location fields filled from a place: the street with its area, the LGA
 * and the state. A field the place doesn't know comes back empty, for the buyer to fill.
 */
export function formFromLookup(place: LookedUpPlace, countryCode: string): AddressFormValues {
  return {
    address_1: [place.street, place.area].filter(Boolean).join(", "),
    city: place.district ?? "",
    province: stateFromLookup(place.state, countryCode) ?? "",
  }
}

type Point = { latitude: number; longitude: number }

/** Where each country's map opens: the country, and each state (Google's geocode of it, 2026-10-04). */
const MAP_CENTRES: Record<string, { country: Point; states: Record<string, Point> }> = {
  NG: {
    country: { latitude: 9.082, longitude: 8.6753 },
    states: {
      Abia: { latitude: 5.4527, longitude: 7.5248 },
      Adamawa: { latitude: 9.3265, longitude: 12.3984 },
      "Akwa Ibom": { latitude: 4.9057, longitude: 7.8537 },
      Anambra: { latitude: 6.2209, longitude: 6.937 },
      Bauchi: { latitude: 10.7761, longitude: 9.9992 },
      Bayelsa: { latitude: 4.7719, longitude: 6.0699 },
      Benue: { latitude: 7.3369, longitude: 8.7404 },
      Borno: { latitude: 11.8846, longitude: 13.152 },
      "Cross River": { latitude: 5.8702, longitude: 8.5988 },
      Delta: { latitude: 5.704, longitude: 5.9339 },
      Ebonyi: { latitude: 6.2649, longitude: 8.0137 },
      Edo: { latitude: 6.6342, longitude: 5.9304 },
      Ekiti: { latitude: 7.719, longitude: 5.311 },
      Enugu: { latitude: 6.5364, longitude: 7.4356 },
      "Federal Capital Territory": { latitude: 8.8941, longitude: 7.186 },
      Gombe: { latitude: 10.3638, longitude: 11.1928 },
      Imo: { latitude: 5.572, longitude: 7.0588 },
      Jigawa: { latitude: 11.719, longitude: 9.3578 },
      Kaduna: { latitude: 10.3764, longitude: 7.7095 },
      Kano: { latitude: 11.7471, longitude: 8.5247 },
      Katsina: { latitude: 12.3797, longitude: 7.6306 },
      Kebbi: { latitude: 12.4376, longitude: 4.2078 },
      Kogi: { latitude: 7.7337, longitude: 6.6906 },
      Kwara: { latitude: 8.9669, longitude: 4.3874 },
      Lagos: { latitude: 6.5227, longitude: 3.6218 },
      Nasarawa: { latitude: 8.4998, longitude: 8.1997 },
      Niger: { latitude: 9.9309, longitude: 5.5983 },
      Ogun: { latitude: 6.998, longitude: 3.4737 },
      Ondo: { latitude: 6.9149, longitude: 5.1478 },
      Osun: { latitude: 7.5629, longitude: 4.52 },
      Oyo: { latitude: 8.1574, longitude: 3.6147 },
      Plateau: { latitude: 9.2182, longitude: 9.5179 },
      Rivers: { latitude: 4.8396, longitude: 6.9112 },
      Sokoto: { latitude: 13.0533, longitude: 5.3223 },
      Taraba: { latitude: 7.9994, longitude: 10.774 },
      Yobe: { latitude: 12.2939, longitude: 11.439 },
      Zamfara: { latitude: 12.1222, longitude: 6.2236 },
    },
  },
}

/**
 * Where the pin map opens for an address entered by hand with location off: the chosen state,
 * or the whole country before one is chosen. `zoom` says which, for how close to show it.
 */
export function mapCentre(state: string | null | undefined, countryCode: string): Point & { zoom: "state" | "country" } {
  const { countryCode: code } = getAddressConfig(countryCode)
  const centres = MAP_CENTRES[code]
  if (!centres) throw new Error(`No map centre for country ${code}`)
  const centre = state ? centres.states[state] : undefined
  return centre ? { ...centre, zoom: "state" } : { ...centres.country, zoom: "country" }
}
