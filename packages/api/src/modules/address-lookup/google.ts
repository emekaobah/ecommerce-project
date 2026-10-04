import { MedusaError } from "@medusajs/framework/utils"
import type { LookedUpPlace } from "@oja/domain"
import type { AddressLookupProvider, AddressSuggestion } from "./provider"

export const GOOGLE_PLACES_API_URL = "https://places.googleapis.com/v1"
export const GOOGLE_GEOCODING_API_URL = "https://maps.googleapis.com/maps/api/geocode/json"

/**
 * Place Details' Essentials fields, all we need. Asking for any other (`displayName`) moves
 * every Details call to a dearer SKU (ADR 0002).
 */
export const ESSENTIALS_FIELD_MASK = "addressComponents,formattedAddress,location"

export type GoogleOptions = {
  apiKey: string
  /** Overridden only to point tests at a fake. */
  placesUrl?: string
  geocodingUrl?: string
}

/** An address component, as Places (camelCase) or Geocoding (snake_case) writes it. */
type Component = { longText?: string; shortText?: string; long_name?: string; short_name?: string; types: string[] }

type PlacePrediction = {
  placeId: string
  structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } }
  text?: { text: string }
}
type AutocompleteResponse = { suggestions?: { placePrediction?: PlacePrediction }[] }
type DetailsResponse = {
  formattedAddress?: string
  location?: { latitude: number; longitude: number }
  addressComponents?: Component[]
}
type GeocodeResponse = {
  status: string
  error_message?: string
  results?: { formatted_address: string; address_components: Component[]; geometry: { location: { lat: number; lng: number } } }[]
}

/**
 * The place's address in the provider's words. In NG `administrative_area_level_1` is the state
 * and `administrative_area_level_2` the LGA; level 3 is a ward (checked 2026-10-04, ADR 0002).
 */
function placeOf(formattedAddress: string, location: { latitude: number; longitude: number }, components: Component[]): LookedUpPlace {
  const find = (...types: string[]) => components.find((c) => types.some((t) => c.types.includes(t)))
  const long = (...types: string[]) => {
    const c = find(...types)
    return c?.longText ?? c?.long_name ?? null
  }
  const route = long("route")
  const country = find("country")
  return {
    formatted_address: formattedAddress,
    location,
    country_code: country?.shortText ?? country?.short_name ?? null,
    street: route ? [long("street_number"), route].filter(Boolean).join(" ") : null,
    area: long("neighborhood", "sublocality", "sublocality_level_1"),
    town: long("locality"),
    district: long("administrative_area_level_2"),
    state: long("administrative_area_level_1"),
    postal_code: long("postal_code"),
  }
}

/** Google Places API (New) autocomplete and details, and the Geocoding API's reverse geocode. */
export class GoogleAddressLookup implements AddressLookupProvider {
  private readonly placesUrl: string
  private readonly geocodingUrl: string

  constructor(private readonly options: GoogleOptions) {
    this.placesUrl = options.placesUrl || GOOGLE_PLACES_API_URL
    this.geocodingUrl = options.geocodingUrl || GOOGLE_GEOCODING_API_URL
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<{ status: number; body: T | null }> {
    try {
      const res = await fetch(url, init)
      return { status: res.status, body: (await res.json().catch(() => null)) as T | null }
    } catch (error) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Couldn't reach Google: ${(error as Error).message}`)
    }
  }

  private places<T>(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
    return this.request<T>(`${this.placesUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", "X-Goog-Api-Key": this.options.apiKey, ...init.headers },
    })
  }

  private static refused(status: number, body: unknown): never {
    const message = (body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${status}`
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Google refused the address lookup: ${message}`)
  }

  async suggest({ text, sessionToken, countries }: { text: string; sessionToken: string; countries: string[] }) {
    const { status, body } = await this.places<AutocompleteResponse>("/places:autocomplete", {
      method: "POST",
      body: JSON.stringify({ input: text, sessionToken, includedRegionCodes: countries }),
    })
    if (status !== 200 || !body) GoogleAddressLookup.refused(status, body)
    return (body.suggestions ?? []).flatMap(({ placePrediction: p }): AddressSuggestion[] =>
      p
        ? [
            {
              place_id: p.placeId,
              main_text: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
              secondary_text: p.structuredFormat?.secondaryText?.text ?? "",
            },
          ]
        : []
    )
  }

  async details({ placeId, sessionToken }: { placeId: string; sessionToken: string }) {
    const query = new URLSearchParams({ sessionToken })
    const { status, body } = await this.places<DetailsResponse>(`/places/${encodeURIComponent(placeId)}?${query}`, {
      headers: { "X-Goog-FieldMask": ESSENTIALS_FIELD_MASK },
    })
    if (status === 404 || (status === 400 && /not.*valid|invalid/i.test(JSON.stringify(body)))) return null
    if (status !== 200 || !body?.location) GoogleAddressLookup.refused(status, body)
    return placeOf(body.formattedAddress ?? "", body.location, body.addressComponents ?? [])
  }

  async reverseGeocode({ latitude, longitude, countries }: { latitude: number; longitude: number; countries: string[] }) {
    const query = new URLSearchParams({ latlng: `${latitude},${longitude}`, key: this.options.apiKey })
    const { status, body } = await this.request<GeocodeResponse>(`${this.geocodingUrl}?${query}`)
    if (body?.status === "ZERO_RESULTS") return null
    if (status !== 200 || body?.status !== "OK") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Google refused the address lookup: ${body?.error_message ?? body?.status ?? `HTTP ${status}`}`
      )
    }
    // Results run from the most precise (a street address) to the country.
    const places = (body.results ?? []).map((r) =>
      placeOf(r.formatted_address, { latitude: r.geometry.location.lat, longitude: r.geometry.location.lng }, r.address_components)
    )
    return places.find((p) => p.country_code && countries.includes(p.country_code.toLowerCase())) ?? null
  }
}
