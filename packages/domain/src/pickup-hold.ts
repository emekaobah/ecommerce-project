import { afterOpenDays, dateIn, dayLabel, isOpenAt, timeLabel, type ShopHours } from "./shop-hours"

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
  return afterOpenDays(hours, new Date(readyAt), holdOpenDays(lines))?.toISOString() ?? null
}

const holdOpenDays = (lines: { perishable: boolean }[]) =>
  lines.some((l) => l.perishable) ? PERISHABLE_HOLD_OPEN_DAYS : PICKUP_HOLD_OPEN_DAYS

/**
 * A reminder to the buyer of a pickup order still to collect (#33): half-way through its hold,
 * from its middle open day (the 3rd of 5), and on its last day.
 */
export type HoldReminder = "half_way" | "last_day"

/**
 * The reminder due at `now` to the buyer of a pickup order that became Ready at `readyAt`, or
 * null: only while the shop is open, before the hold ends. `sent` is the last reminder the order
 * had. A half-way reminder not sent by the last day is skipped; a hold of one open day (a
 * perishable order's) has only the last day's. None while the hold's clock is frozen.
 */
export function holdReminderDue(
  hours: ShopHours,
  readyAt: string,
  lines: { perishable: boolean }[],
  now: Date,
  sent: HoldReminder | null
): HoldReminder | null {
  if (sent === "last_day" || !isOpenAt(hours, now)) return null
  const days = holdOpenDays(lines)
  const ends = afterOpenDays(hours, new Date(readyAt), days)
  if (!ends || now >= ends) return null
  // The open day a deadline falls on: closing at midnight is still that day.
  const dayOf = (closes: Date) => dateIn(closes.getTime() - 1, hours.time_zone)
  const today = dateIn(now.getTime(), hours.time_zone)
  if (today === dayOf(ends)) return "last_day"
  if (sent || days < 2) return null
  const middle = afterOpenDays(hours, new Date(readyAt), Math.ceil(days / 2))
  return middle && today >= dayOf(middle) ? "half_way" : null
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
