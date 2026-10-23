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

/** "Mon 20 Oct · open until 7pm" with an Open chip: the shop's state as its staff read it now. */
export function vendorShopState(hours: ShopHours, now: Date): VendorShopState {
  const status = shopStatus(hours, now)
  const paused = status.state === "closed_until" && status.reason === "pause"
  const label = status.state === "open" ? "Open" : paused ? "Paused" : "Closed"
  return {
    chip: shopStatusChip(status.state, label),
    line: `${dateLabel(now, hours.time_zone)} · ${stateLine(status, now, hours.time_zone)}`,
  }
}
