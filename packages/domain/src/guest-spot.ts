import type { Pin } from "./address-form"

/**
 * A guest's spot (ADR 0015): where their phone was when they tapped "Use my current location",
 * kept on the device and sent as `near`, so shops are measured from it until they save an address.
 * `name` is the phone's own geocoder's area or street, null when it found none.
 */
export type GuestSpot = Pin & { name: string | null }

/** The parts of a reverse-geocoded place (`expo-location`'s `reverseGeocodeAsync`) a spot is named from. */
export type GeocodedPlace = {
  district?: string | null
  street?: string | null
}

/** The spot's name: its area, else its street; null without either ("Your current location"). */
export function guestSpotName(place: GeocodedPlace | undefined): string | null {
  const name = [place?.district, place?.street].map((part) => part?.trim()).find(Boolean)
  return name ?? null
}

/** Where a store route measures shops from: the saved address's id, else the guest's spot, else nowhere. */
export type MeasuredFrom = { addressId: string | null; near: Pin | null }

/**
 * The query parameters for `MeasuredFrom` on the listing and shop routes (ADR 0011, 0015): a
 * saved address wins; otherwise the spot as `near=lat,lng`, which the server snaps to its grid.
 */
export function measuredFrom({ addressId, near }: MeasuredFrom): { address_id?: string; near?: string } {
  if (addressId) return { address_id: addressId }
  if (near) return { near: `${near.latitude},${near.longitude}` }
  return {}
}
