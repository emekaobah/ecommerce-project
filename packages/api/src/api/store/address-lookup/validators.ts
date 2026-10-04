import { z } from "@medusajs/framework/zod"

const required = z.string().trim().min(1)

/** Every lookup is for the buyer's cart, whose region decides the countries searched (ADR 0002). */
const lookup = {
  cart_id: required,
}

/**
 * The client's lookup session: a UUID it makes when the buyer starts searching and keeps until
 * they choose a place, so Google bills the search and the details as one session.
 */
const sessionToken = z.string().trim().min(1).max(36)

export const StoreSuggestAddresses = z.object({ ...lookup, session_token: sessionToken, input: required.max(200) })
export type StoreSuggestAddressesType = z.infer<typeof StoreSuggestAddresses>

export const StoreGetPlaceAddress = z.object({ ...lookup, session_token: sessionToken })
export type StoreGetPlaceAddressType = z.infer<typeof StoreGetPlaceAddress>

export const StoreReverseGeocode = z.object({
  ...lookup,
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
})
export type StoreReverseGeocodeType = z.infer<typeof StoreReverseGeocode>
