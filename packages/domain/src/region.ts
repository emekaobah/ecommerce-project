type RegionLike = { countries?: { iso_2?: string | null }[] | null }

/**
 * Picks the backend region serving the device's country (ISO 3166-1 alpha-2),
 * falling back to the first region. Undefined only when there are no regions.
 */
export function selectRegion<R extends RegionLike>(
  regions: readonly R[],
  countryCode: string | null | undefined
): R | undefined {
  const country = countryCode?.toLowerCase()
  return regions.find((r) => r.countries?.some((c) => c.iso_2 === country)) ?? regions[0]
}
