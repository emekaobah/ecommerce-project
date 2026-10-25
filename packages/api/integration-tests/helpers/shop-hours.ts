import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { WEEKDAYS, type OpenPeriod, type Weekday, type WeeklyHours } from "@oja/domain"
import { setWeeklyHours } from "../../src/lib/shop-hours"

/** Open round the clock, every day. */
export const ALWAYS_OPEN = Object.fromEntries(WEEKDAYS.map((day) => [day, [{ opens: "00:00", closes: "24:00" }]])) as WeeklyHours

/**
 * Keeps the seeded shops open round the clock, so a test's clocks (the accept deadline counts
 * the shop's open hours, ADR 0004) run like wall-clock time whenever it runs.
 */
export async function keepShopsOpen(container: MedusaContainer, shops: { name: string }[]) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "seller", fields: ["id"], filters: { name: shops.map((s) => s.name) } })
  await Promise.all((data as { id: string }[]).map((seller) => setWeeklyHours(container, seller.id, ALWAYS_OPEN)))
}

/** An instant's weekday and "HH:MM" (minutes, rounded down) in the timezone. */
function localTo(instant: number, timeZone: string): { day: Weekday; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value
  return { day: part("weekday").toLowerCase() as Weekday, time: `${part("hour")}:${part("minute")}` }
}

/**
 * Open round the clock except from `closes` to `opens` (instants, on the minute, under a day
 * apart), on those weekdays every week in the shop's timezone: a shop that shuts for one night a
 * test chooses.
 */
export function closedBetween(closes: number, opens: number, timeZone: string): WeeklyHours {
  const from = localTo(closes, timeZone)
  const to = localTo(opens, timeZone)
  const open = (start: string, end: string): OpenPeriod[] => (start < end ? [{ opens: start, closes: end }] : [])
  const weekly = { ...ALWAYS_OPEN }
  if (from.day === to.day) {
    weekly[from.day] = [...open("00:00", from.time), ...open(to.time, "24:00")]
  } else {
    weekly[from.day] = open("00:00", from.time)
    weekly[to.day] = open(to.time, "24:00")
  }
  return weekly
}
