import { afterOpenDays, dateIn, dayLabel, timeLabel, type ShopHours } from "./shop-hours"

/**
 * How long a pickup order waits at the counter (#32, docs/design.md → Pickup, ADR 0004): from
 * Ready for pickup, counted in the shop's open days, until it is Not collected.
 */

/** A non-perishable order is held until the shop closes on this open day after Ready. */
export const PICKUP_HOLD_OPEN_DAYS = 5
/** A perishable order is held until the shop closes on its next open day after Ready. */
export const PERISHABLE_HOLD_OPEN_DAYS = 1

/**
 * When a pickup order that became Ready at `readyAt` (ISO 8601) must be collected by, as ISO
 * 8601: closing time on the 5th open day after Ready, or on the next one when any of its lines
 * is perishable (a mixed order takes the shorter hold). Null while the shop is paused with no
 * resume date: the clock is frozen.
 */
export function collectBy(hours: ShopHours, readyAt: string, lines: { perishable: boolean }[]): string | null {
  const days = lines.some((l) => l.perishable) ? PERISHABLE_HOLD_OPEN_DAYS : PICKUP_HOLD_OPEN_DAYS
  return afterOpenDays(hours, new Date(readyAt), days)?.toISOString() ?? null
}

/**
 * "Collect by 6pm, Thu 15 Oct", or "Collect by 6pm today" on the last day: when a pickup order's
 * hold ends (`collectBy`, ISO 8601), in the region's timezone, as its buyer and the shop's staff read it.
 */
export function collectByLabel(collectBy: string, now: Date, timeZone: string): string {
  const instant = Date.parse(collectBy)
  const time = timeLabel(instant, timeZone)
  if (dateIn(instant, timeZone) === dateIn(now.getTime(), timeZone)) return `Collect by ${time} today`
  return `Collect by ${time}, ${dayLabel(instant, timeZone, { weekday: "short", day: "numeric", month: "short" })}`
}
