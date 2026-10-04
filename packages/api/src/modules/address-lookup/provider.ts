import type { LookedUpPlace } from "@oja/domain"

/** A place autocomplete suggests for what the buyer typed. */
export type AddressSuggestion = {
  /** The provider's id for the place, to look up its details; never stored (ADR 0002). */
  place_id: string
  /** e.g. "3 Akin Adesola Street". */
  main_text: string
  /** e.g. "Victoria Island, Lagos, Nigeria". */
  secondary_text: string
}

/**
 * Finds delivery addresses for the buyer (ADR 0002). One provider per region, like the shipment
 * provider; Google is the first. `countries` (ISO 3166-1 alpha-2, lower case) are the region's,
 * and `sessionToken` the client's lookup session, which ties a search to the place chosen from it.
 */
export interface AddressLookupProvider {
  suggest(input: { text: string; sessionToken: string; countries: string[] }): Promise<AddressSuggestion[]>
  /** The place, or null when the provider has no such place. */
  details(input: { placeId: string; sessionToken: string }): Promise<LookedUpPlace | null>
  /** The address at a point in one of `countries`, or null when there is none. */
  reverseGeocode(input: { latitude: number; longitude: number; countries: string[] }): Promise<LookedUpPlace | null>
}
