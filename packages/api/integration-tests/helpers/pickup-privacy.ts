import { SEED_SELLERS } from "../../src/scripts/seed-data"

/**
 * The seeded shops' pickup coordinates and street addresses found in a response body, which a
 * buyer's listing and shop routes never tell (ADR 0011, 0015): empty when none leaked.
 */
export function pickupDetailsIn(body: unknown): string[] {
  const text = JSON.stringify(body)
  return SEED_SELLERS.flatMap(({ pickup }) => [String(pickup.latitude), String(pickup.longitude), pickup.address_1]).filter(
    (detail) => text.includes(detail)
  )
}
