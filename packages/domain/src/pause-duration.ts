import { dateLabel } from "./date-label"
import { closingTime, dateIn, nextOpening, openingLabel, timeLabel, type ShopHours, type ShopPause } from "./shop-hours"

/** How long staff pause the shop's orders for (ADR 0004): `until` is when it ends (ISO 8601), null until resumed. */
export type PauseDuration = { key: "hour" | "next_opening" | "resume"; label: string; until: string | null }

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** "today", "tomorrow", "Mon" within the week, else "Mon 2 Nov": the day of `instant` from `now`'s. */
function dayWord(instant: number, now: Date, timeZone: string): string {
  const days = (Date.parse(dateIn(instant, timeZone)) - Date.parse(dateIn(now.getTime(), timeZone))) / DAY_MS
  if (days === 0) return "today"
  if (days === 1) return "tomorrow"
  return dateLabel(instant, timeZone, { date: days >= 7 })
}

/**
 * When the shop next opens once the first hour is up, closing first if it is open then: the end
 * of a pause "until it opens again". Null without hours, or for a shop that never closes.
 */
function openingAfterAnHour(hours: ShopHours, now: Date): Date | null {
  const inAnHour = new Date(now.getTime() + HOUR_MS)
  const opensAt = nextOpening(hours, inAnHour)
  if (!opensAt || opensAt.getTime() > inAnHour.getTime()) return opensAt
  const closesAt = closingTime(hours, inAnHour)
  return closesAt ? nextOpening(hours, closesAt) : null
}

/**
 * The pauses staff choose from, in plain words (catalogue v-shop #5): an hour ("1 hour · until
 * 3:47pm"), until the shop next opens after that ("Until tomorrow, 8am", left out without hours
 * or for a shop that never closes), and until they turn orders back on. There is no "until
 * closing time": outside its hours a shop still takes orders, so that pause would end as it
 * closed. Times read in the shop's `timeZone`.
 */
export function pauseDurations(now: Date, hours: ShopHours | null, timeZone: string): PauseDuration[] {
  const inAnHour = now.getTime() + HOUR_MS
  const durations: PauseDuration[] = [
    { key: "hour", label: `1 hour · until ${timeLabel(inAnHour, timeZone)}`, until: new Date(inAnHour).toISOString() },
  ]
  const opensAt = hours ? openingAfterAnHour(hours, now) : null
  if (opensAt) {
    const at = opensAt.getTime()
    durations.push({ key: "next_opening", label: `Until ${dayWord(at, now, timeZone)}, ${timeLabel(at, timeZone)}`, until: opensAt.toISOString() })
  }
  durations.push({ key: "resume", label: "I turn it back on", until: null })
  return durations
}

/**
 * Under "Taking orders": how to pause, or until when the shop is paused (in its time zone) and
 * what buyers read. Before the shop's hours load (null), how to pause.
 */
export function takingOrdersLine(
  shop: { time_zone: string; pause: Pick<ShopPause, "ends_at" | "note"> | null } | null,
  now: Date
): string {
  const pause = shop?.pause
  if (!shop || !pause) return "Turn off to pause the shop now"
  const until = pause.ends_at ? `Paused until ${openingLabel(pause.ends_at, now, shop.time_zone)}.` : "Paused until you turn it back on."
  return pause.note ? `${until} Buyers see: “${pause.note}”` : until
}

/** The pause confirm's line of consequence when new orders wait to be accepted: pausing doesn't stop their clocks (#18). */
export function pauseWaitingMessage(count: number): string {
  return count === 1
    ? "1 new order is still waiting to be accepted. Pausing stops new orders, not this one: accept or reject it, or it'll be rejected at its deadline."
    : `${count} new orders are still waiting to be accepted. Pausing stops new orders, not these: accept or reject them, or they'll be rejected at their deadline.`
}
