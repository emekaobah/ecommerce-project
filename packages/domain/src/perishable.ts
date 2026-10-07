/**
 * Perishables (#69, docs/design.md → Perishables): fresh and chilled groceries only go out with
 * couriers fast enough to keep them fresh.
 */

/**
 * Whether a product is perishable: the operator's override when set, else whether any of its
 * categories is (each category counting its parents' flags too).
 */
export function isPerishable({ override, categories }: { override: boolean | null; categories: boolean[] }): boolean {
  return override ?? categories.some(Boolean)
}

/** What the buyer app tells a buyer about delivering perishable items. */
export const PERISHABLE_DELIVERY_RULE = "Fresh and chilled items are delivered only by couriers arriving by the end of the next day."

/** The calendar date of an instant in a timezone, as YYYY-MM-DD. */
const dateIn = (instant: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(instant)

/** The calendar date after a YYYY-MM-DD date. */
const dayAfter = (date: string) => {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}

/**
 * Whether a parcel arriving at `etaTime` (ISO 8601) arrives by the end of the day after `now`,
 * counting days in the region's timezone. An ETA that can't be read doesn't qualify.
 */
export function arrivesByEndOfNextDay(etaTime: string, now: Date, timeZone: string): boolean {
  const arrives = new Date(etaTime)
  if (Number.isNaN(arrives.getTime())) return false
  // YYYY-MM-DD dates compare as strings.
  return dateIn(arrives, timeZone) <= dayAfter(dateIn(now, timeZone))
}
