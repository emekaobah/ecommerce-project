import { afterOpenDays, type ShopHours } from "./shop-hours"

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
