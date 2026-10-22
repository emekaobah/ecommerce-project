import { afterOpenTime, openTimeBetween, type ShopHours } from "./shop-hours"

/**
 * How long a shop has to accept a new order before it is rejected and refunded (#20): 24 hours
 * of the shop's open time (ADR 0004), so an order placed as a shop closes for the weekend isn't
 * rejected before anyone sees it. A pause stops new orders, not this clock: an order waiting
 * when the shop pauses is still accepted or rejected on time (#18).
 */
const ACCEPT_WINDOW_MS = 24 * 60 * 60 * 1000

/** Within this much of the deadline, the countdown is shown as urgent. */
const URGENT_MS = 2 * 60 * 60 * 1000

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

/**
 * The hours an order placed at `placedAt` counts its time to accept in: a pause that starts
 * after the order was placed counts as open time, while closed hours and closures still don't.
 */
const orderClock = (hours: ShopHours, placedAt: string): ShopHours => ({
  ...hours,
  pauses: hours.pauses.filter((p) => Date.parse(p.starts_at) <= Date.parse(placedAt)),
})

/**
 * When an order placed at `placedAt` (ISO 8601) must be accepted by, as ISO 8601: after 24 of
 * the shop's open hours, counting pauses that started after it was placed as open. Null only
 * when the shop doesn't reopen to finish the clock. A shop without hours (made before they
 * were required) gets 24 hours of wall-clock time.
 */
export function acceptDeadline(placedAt: string, hours: ShopHours | null): string | null {
  if (!hours) return new Date(Date.parse(placedAt) + ACCEPT_WINDOW_MS).toISOString()
  return afterOpenTime(orderClock(hours, placedAt), new Date(placedAt), ACCEPT_WINDOW_MS)?.toISOString() ?? null
}

/**
 * Whether staff should be reminded of a new order placed at `placedAt` (ISO 8601): from when
 * two of the shop's open hours are left until the deadline, after which the order is rejected instead.
 */
export function acceptReminderDue(placedAt: string, now: Date, hours: ShopHours | null): boolean {
  const deadline = acceptDeadline(placedAt, hours)
  if (!deadline || Date.parse(deadline) <= now.getTime()) return false
  const left = hours ? openTimeBetween(orderClock(hours, placedAt), now, new Date(deadline)) : Date.parse(deadline) - now.getTime()
  return left <= URGENT_MS
}

/**
 * The open time left before `deadline`: a pause doesn't stop the clock, so pauses count as open.
 * (No pause can have started before the order was placed and still be running: a paused shop
 * takes no orders.) Wall-clock time for a shop without hours.
 */
const openTimeLeft = (deadline: string, now: Date, hours: ShopHours | null): number =>
  hours ? openTimeBetween({ ...hours, pauses: [] }, now, new Date(deadline)) : Math.max(0, Date.parse(deadline) - now.getTime())

export type AcceptTimeLeft = { label: string; accessibilityLabel: string; urgent: boolean }

/**
 * The countdown staff see on a new order: "5h 12m left", "21h left", "24m left", or "Overdue".
 * With the shop's hours it counts open time, so it holds still overnight and turns urgent in
 * the last two open hours, when the reminder push goes; without them, the wall clock.
 */
export function acceptTimeLeft(deadline: string, now: Date, hours: ShopHours | null = null): AcceptTimeLeft {
  const overdue = Date.parse(deadline) <= now.getTime()
  const left = overdue ? 0 : openTimeLeft(deadline, now, hours)
  const urgent = left <= URGENT_MS
  if (overdue) return { label: "Overdue", accessibilityLabel: "Overdue to accept", urgent }
  const hoursLeft = Math.floor(left / HOUR_MS)
  const minutes = Math.floor((left % HOUR_MS) / MINUTE_MS)
  const time =
    left < MINUTE_MS ? "Less than a minute" : !hoursLeft ? `${minutes}m` : minutes ? `${hoursLeft}h ${minutes}m` : `${hoursLeft}h`
  return {
    label: `${time} left`,
    accessibilityLabel: `${time} ${hours ? "of open time " : ""}left to accept`,
    urgent,
  }
}

/**
 * How much of the 24 open hours to accept is left at `now`, from 1 (all of it) to 0 (overdue):
 * the time chip's outline drains by it. It holds still while the shop is closed.
 */
export function acceptClockFraction(deadline: string, now: Date, hours: ShopHours | null): number {
  return Math.min(1, openTimeLeft(deadline, now, hours) / ACCEPT_WINDOW_MS)
}
