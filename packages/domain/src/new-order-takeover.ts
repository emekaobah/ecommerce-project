// What the vendor app's new-order takeover says (#83, catalogue v-triage #2).

import { acceptClockTime, acceptTimeLeft } from "./accept-deadline"
import { itemsLabel } from "./items-label"
import type { ShopHours } from "./shop-hours"

/** The order as the takeover announces it; `total` already in money. */
export type TakeoverOrder = { displayId: number; method: string; itemCount: number; total: string; acceptBy: string | null }

/** What VoiceOver and TalkBack say as the takeover opens: "New order #1044, delivery, 3 items, ₦32,500.00. 23h 58m left to accept." */
export function takeoverAnnouncement(order: TakeoverOrder, now: Date, hours: ShopHours | null): string {
  const summary = `New order #${order.displayId}, ${order.method}, ${itemsLabel(order.itemCount)}, ${order.total}.`
  return order.acceptBy ? `${summary} ${acceptTimeLeft(order.acceptBy, now, hours).accessibilityLabel}.` : summary
}

/** "Accept within 23h 58m", counted in the shop's open hours; "Overdue to accept" once past it. */
export function acceptWithinLabel(acceptBy: string, now: Date, hours: ShopHours | null): string {
  const time = acceptClockTime(acceptBy, now, hours)
  return time === "Overdue" ? "Overdue to accept" : `Accept within ${time}`
}
