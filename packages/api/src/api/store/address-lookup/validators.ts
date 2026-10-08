import { z } from "@medusajs/framework/zod"

const required = z.string().trim().min(1)

/**
 * Every lookup is for the buyer's cart, or, adding a saved address with no cart (#18), for the
 * region the app shops in. Either one's region decides the countries searched (ADR 0002).
 */
const lookup = {
  cart_id: required.optional(),
  region_id: required.optional(),
}

/** True when the lookup names exactly one of a cart and a region. */
const isForCartOrRegion = <T extends { cart_id?: string; region_id?: string }>(query: T) =>
  Boolean(query.cart_id) !== Boolean(query.region_id)

/** Exactly one of `cart_id` and `region_id`. */
const CART_OR_REGION = { message: "Send a cart_id or a region_id, one of the two" }

/**
 * The client's lookup session: a UUID it makes when the buyer starts searching and keeps until
 * they choose a place, so Google bills the search and the details as one session.
 */
export const sessionToken = z.string().trim().min(1).max(36)

/** What was typed into the search. */
export const searchInput = required.max(200)

/** A point to reverse geocode. */
export const point = {
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
}

export const StoreSuggestAddresses = z
  .object({ ...lookup, session_token: sessionToken, input: searchInput })
  .refine(isForCartOrRegion, CART_OR_REGION)
export type StoreSuggestAddressesType = z.infer<typeof StoreSuggestAddresses>

export const StoreGetPlaceAddress = z
  .object({ ...lookup, session_token: sessionToken })
  .refine(isForCartOrRegion, CART_OR_REGION)
export type StoreGetPlaceAddressType = z.infer<typeof StoreGetPlaceAddress>

export const StoreReverseGeocode = z
  .object({
    ...lookup,
    ...point,
  })
  .refine(isForCartOrRegion, CART_OR_REGION)
export type StoreReverseGeocodeType = z.infer<typeof StoreReverseGeocode>
