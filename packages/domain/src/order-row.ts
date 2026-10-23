import { dateLabel } from "./date-label"
import { orderNumber } from "./order-number"

/** What an order row's meta line reads from its checkout. */
export type OrderRowFacts = {
  /** When it was placed (ISO 8601). */
  createdAt: string
  /** Units across all its items. */
  itemCount: number
  displayId: number
}

/** The calendar day of `at` in `timeZone`, as "2026-10-23". */
const dayIn = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at)

/** How far back a checkout still reads with its weekday: a buyer places these by the day of the week. */
const WEEKDAY_DAYS = 28
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * When the checkout was placed, in the buyer's time zone: "Today"; "Sat 18 Oct" within four
 * weeks; "20 Sep" earlier this year; "28 Dec 2025" before that.
 */
function placedOn(placed: Date, now: Date, timeZone: string) {
  const placedDay = dayIn(placed, timeZone)
  const today = dayIn(now, timeZone)
  if (placedDay === today) return "Today"
  const daysAgo = (Date.parse(today) - Date.parse(placedDay)) / DAY_MS
  const sameYear = placedDay.slice(0, 4) === today.slice(0, 4)
  return dateLabel(placed, timeZone, { weekday: daysAgo < WEEKDAY_DAYS, year: !sameYear })
}

/** An order row's meta line: "Today · 4 items · OJ-2410". */
export function orderRowMeta({ createdAt, itemCount, displayId }: OrderRowFacts, now: Date, timeZone: string): string {
  const items = `${itemCount} ${itemCount === 1 ? "item" : "items"}`
  return [placedOn(new Date(createdAt), now, timeZone), items, orderNumber(displayId)].join(" · ")
}
