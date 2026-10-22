import type { Pin } from "@oja/domain"

// Small SQL builders shared by the reads that go to Postgres directly (ADR 0014): ranking
// listings, searching a buyer's orders, measuring to collection points.

const EARTH_RADIUS_KM = 6371

/**
 * The haversine distance in kilometres from a pin to a shop's pin columns, as SQL, worked out as
 * `distanceKm` in `@oja/domain` does; NULL without a pin to measure from. The pin's coordinates
 * are numbers, written into the SQL as such.
 */
export function haversineKmSql(from: Pin | null | undefined, pin = { latitude: "sp.latitude", longitude: "sp.longitude" }) {
  const fromLat = Number(from?.latitude)
  const fromLng = Number(from?.longitude)
  if (!from || !Number.isFinite(fromLat) || !Number.isFinite(fromLng)) return "NULL::double precision"
  const lat = `${pin.latitude}::double precision`
  const lng = `${pin.longitude}::double precision`
  return (
    `(2 * ${EARTH_RADIUS_KM} * asin(least(1, sqrt(` +
    `power(sin(radians(${lat} - ${fromLat}) / 2), 2) + cos(radians(${fromLat})) * cos(radians(${lat})) * power(sin(radians(${lng} - ${fromLng}) / 2), 2)` +
    `))))`
  )
}

/** `word` with LIKE's wildcards escaped, for a pattern matched with `ESCAPE '\'`. */
export const escapeLike = (word: string) => word.replaceAll(/[\\%_]/g, (c) => `\\${c}`)
