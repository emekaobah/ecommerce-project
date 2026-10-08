import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { WEEKDAYS, type WeeklyHours } from "@oja/domain"
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
  for (const seller of data as { id: string }[]) await setWeeklyHours(container, seller.id, ALWAYS_OPEN)
}
