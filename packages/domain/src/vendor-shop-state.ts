import { dateLabel } from "./date-label"
import { openingLabel, shopStatus, shopStatusChip, type ShopHours, type ShopStatus } from "./shop-hours"
import type { StatusChipView } from "./status"

/** The vendor orders header's state: its chip ("Open", leaf) and the line under the shop's name. */
export type VendorShopState = { chip: StatusChipView; line: string }

/** What the state says after the date: "open until 7pm", "opens 7am Mon", "paused until 3pm". */
function stateLine(status: ShopStatus, now: Date, timeZone: string): string {
  const at = (iso: string) => openingLabel(iso, now, timeZone)
  if (status.state === "open") return status.closes_at ? `open until ${at(status.closes_at)}` : "open all day"
  if (status.state === "closed") return status.opens_at ? `opens ${at(status.opens_at)}` : "closed"
  const closed = status.reason === "pause" ? "paused" : "closed"
  return status.until ? `${closed} until ${at(status.until)}` : closed
}

/** The chip's word: "Open", "Paused" (closed by staff) or "Closed". */
function chipLabel(status: ShopStatus): string {
  if (status.state === "open") return "Open"
  return status.state === "closed_until" && status.reason === "pause" ? "Paused" : "Closed"
}

/** "Mon 20 Oct · open until 7pm" with an Open chip: the shop's state as its staff read it now. */
export function vendorShopState(hours: ShopHours, now: Date): VendorShopState {
  const status = shopStatus(hours, now)
  return {
    chip: shopStatusChip(status.state, chipLabel(status)),
    line: `${dateLabel(now, hours.time_zone)} · ${stateLine(status, now, hours.time_zone)}`,
  }
}

/**
 * "Open until 7pm · 2 orders waiting": the line under the shop's name on Settings, its state now
 * and how many new orders wait to be accepted (left out when none).
 */
export function settingsShopLine(hours: ShopHours, now: Date, newOrders: number): string {
  const state = stateLine(shopStatus(hours, now), now, hours.time_zone)
  const line = state.charAt(0).toUpperCase() + state.slice(1)
  if (!newOrders) return line
  return `${line} · ${newOrders} ${newOrders === 1 ? "order" : "orders"} waiting`
}
