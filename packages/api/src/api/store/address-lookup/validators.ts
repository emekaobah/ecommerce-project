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

const forCartOrRegion = <T extends { cart_id?: string; region_id?: string }>(query: T) =>
  !query.cart_id !== !query.region_id

const CART_OR_REGION = { message: "Look up for a cart or a region, not both" }

/**
 * The client's lookup session: a UUID it makes when the buyer starts searching and keeps until
 * they choose a place, so Google bills the search and the details as one session.
 */
const sessionToken = z.string().trim().min(1).max(36)

export const StoreSuggestAddresses = z
  .object({ ...lookup, session_token: sessionToken, input: required.max(200) })
  .refine(forCartOrRegion, CART_OR_REGION)
export type StoreSuggestAddressesType = z.infer<typeof StoreSuggestAddresses>

export const StoreGetPlaceAddress = z
  .object({ ...lookup, session_token: sessionToken })
  .refine(forCartOrRegion, CART_OR_REGION)
export type StoreGetPlaceAddressType = z.infer<typeof StoreGetPlaceAddress>

export const StoreReverseGeocode = z
  .object({
    ...lookup,
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
  })
  .refine(forCartOrRegion, CART_OR_REGION)
export type StoreReverseGeocodeType = z.infer<typeof StoreReverseGeocode>
