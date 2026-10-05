/**
 * How long a shop has to accept a new order before it is rejected and refunded (#20).
 *
 * ADR 0004 makes this 24 *open* hours of the shop. Until shop hours exist (#68) it is 24 hours
 * of wall-clock time; this is the one place that changes when they do.
 */
const ACCEPT_WINDOW_MS = 24 * 60 * 60 * 1000

/** Within this much of the deadline, the countdown is shown as urgent. */
const URGENT_MS = 2 * 60 * 60 * 1000

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

/** When an order placed at `placedAt` (ISO 8601) must be accepted by, as ISO 8601. */
export function acceptDeadline(placedAt: string): string {
  return new Date(Date.parse(placedAt) + ACCEPT_WINDOW_MS).toISOString()
}

/**
 * Whether staff should be reminded of a new order placed at `placedAt` (ISO 8601): from when its
 * countdown turns urgent until the deadline, after which the order is rejected instead.
 */
export function acceptReminderDue(placedAt: string, now: Date): boolean {
  const left = Date.parse(acceptDeadline(placedAt)) - now.getTime()
  return left > 0 && left <= URGENT_MS
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
