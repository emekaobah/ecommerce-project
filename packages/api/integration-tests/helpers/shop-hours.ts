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

/** Lagos keeps West Africa Time, UTC+1, all year: the seeded shops' timezone. */
const LAGOS_OFFSET_MS = 60 * 60 * 1000

/** An instant's Lagos weekday and "HH:MM" (minutes, rounded down). */
function inLagos(instant: number): { day: Weekday; time: string } {
  const local = new Date(instant + LAGOS_OFFSET_MS)
  const time = `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`
  return { day: WEEKDAYS[(local.getUTCDay() + 6) % 7]!, time }
}

/**
 * Open round the clock except from `closes` to `opens` (instants, on the minute, under a day
 * apart), on those weekdays every week: a shop that shuts for one night a test chooses.
 */
export function closedBetween(closes: number, opens: number): WeeklyHours {
  const from = inLagos(closes)
  const to = inLagos(opens)
  const open = (opens: string, closes: string): OpenPeriod[] => (opens < closes ? [{ opens, closes }] : [])
  const weekly = { ...ALWAYS_OPEN }
  if (from.day === to.day) {
    weekly[from.day] = [...open("00:00", from.time), ...open(to.time, "24:00")]
  } else {
    weekly[from.day] = open("00:00", from.time)
    weekly[to.day] = open(to.time, "24:00")
  }
  return weekly
}
