import type { Pin } from "./address-form"

// How far a shop is from where the buyer is delivering to (#43, ADR 0011): a straight line
// between the buyer's saved address pin and the shop's pickup pin. Listings rank by it in
// bands, and buyers see it rounded, never a shop's coordinates.

const EARTH_RADIUS_KM = 6371

/** The straight-line (haversine) distance between two pins, in kilometres. */
export function distanceKm(a: Pin, b: Pin): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = radians(b.latitude - a.latitude)
  const dLon = radians(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Where one distance band ends and the next begins: under 5 km, 5 to 15 km, over 15 km. */
export const DISTANCE_BANDS_KM = [5, 15] as const

/** A distance's band, nearest first (0 is under 5 km). Listings in one band rank by ship time. */
export function distanceBand(km: number): number {
  const band = DISTANCE_BANDS_KM.findIndex((limit) => km < limit)
  return band === -1 ? DISTANCE_BANDS_KM.length : band
}

/** A distance as buyers are told it: 0 under a kilometre, else the nearest whole kilometre. */
export function roundedDistanceKm(km: number): number {
  return km < 1 ? 0 : Math.round(km)
}

/** A rounded distance for a shop header, "under 1 km" or "3 km". */
export function distanceLabel(roundedKm: number): string {
  return roundedKm < 1 ? "under 1 km" : `${roundedKm} km`
}

/**
 * The saved address listings measure from ("Delivering to"): the one the buyer picked while it
 * is still saved, else their default; none without either, rather than guessing.
 */
export function deliveringTo(
  addresses: readonly { id: string; is_default_shipping?: boolean | null }[],
  pickedId: string | null | undefined
): string | null {
  const picked = pickedId ? addresses.find((a) => a.id === pickedId) : undefined
  return (picked ?? addresses.find((a) => a.is_default_shipping))?.id ?? null
}
