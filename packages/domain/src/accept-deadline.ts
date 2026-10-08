import { afterOpenTime, openTimeBetween, type ShopHours } from "./shop-hours"

/**
 * How long a shop has to accept a new order before it is rejected and refunded (#20): 24 hours
 * of the shop's open time (ADR 0004), so an order placed as a shop closes for the weekend isn't
 * rejected before anyone sees it. A pause stops the clock.
 */
const ACCEPT_WINDOW_MS = 24 * 60 * 60 * 1000

/** Within this much of the deadline, the countdown is shown as urgent. */
const URGENT_MS = 2 * 60 * 60 * 1000

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

/**
 * When an order placed at `placedAt` (ISO 8601) must be accepted by, as ISO 8601: after 24 of
 * the shop's open hours. Null while the shop is paused and not set to reopen. A shop without
 * hours (made before they were required) gets 24 hours of wall-clock time.
 */
export function acceptDeadline(placedAt: string, hours: ShopHours | null): string | null {
  if (!hours) return new Date(Date.parse(placedAt) + ACCEPT_WINDOW_MS).toISOString()
  return afterOpenTime(hours, new Date(placedAt), ACCEPT_WINDOW_MS)?.toISOString() ?? null
}

/**
 * Whether staff should be reminded of a new order placed at `placedAt` (ISO 8601): from when
 * two of the shop's open hours are left until the deadline, after which the order is rejected instead.
 */
export function acceptReminderDue(placedAt: string, now: Date, hours: ShopHours | null): boolean {
  const deadline = acceptDeadline(placedAt, hours)
  if (!deadline || Date.parse(deadline) <= now.getTime()) return false
  const left = hours ? openTimeBetween(hours, now, new Date(deadline)) : Date.parse(deadline) - now.getTime()
  return left <= URGENT_MS
}

export type AcceptTimeLeft = { label: string; urgent: boolean }

/** The countdown staff see on a new order: "5h 12m left", "24m left", or "Overdue". */
export function acceptTimeLeft(deadline: string, now: Date): AcceptTimeLeft {
  const left = Date.parse(deadline) - now.getTime()
  const urgent = left <= URGENT_MS
  if (left <= 0) return { label: "Overdue", urgent }
  if (left < MINUTE_MS) return { label: "Less than a minute left", urgent }
  const hours = Math.floor(left / HOUR_MS)
  const minutes = Math.floor((left % HOUR_MS) / MINUTE_MS)
  return { label: hours ? `${hours}h ${minutes}m left` : `${minutes}m left`, urgent }
}
