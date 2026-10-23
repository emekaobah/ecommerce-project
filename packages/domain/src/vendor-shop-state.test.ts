import { describe, expect, test } from "bun:test"
import type { ShopHours } from "./shop-hours"
import { vendorShopState } from "./vendor-shop-state"

// Weeks in October 2026: Monday 5, Monday 12. Lagos is UTC+1 all year.
const lagos = (local: string) => new Date(`${local}+01:00`)

const weekdays = [{ opens: "08:00", closes: "18:00" }]
const SHOP: ShopHours = {
  time_zone: "Africa/Lagos",
  weekly: { mon: weekdays, tue: weekdays, wed: weekdays, thu: weekdays, fri: weekdays, sat: [], sun: [] },
  exceptions: [],
  pauses: [],
}

describe("vendorShopState", () => {
  test("an open shop: a leaf Open chip and when it closes today", () => {
    expect(vendorShopState(SHOP, lagos("2026-10-05T10:00:00"))).toEqual({
      chip: { label: "Open", tone: "success", icon: "check" },
      line: "Mon 5 Oct · open until 6pm",
    })
  })

  test("a closed shop: a grey Closed chip and when it next opens", () => {
    expect(vendorShopState(SHOP, lagos("2026-10-10T12:00:00"))).toEqual({
      chip: { label: "Closed", tone: "neutral", icon: "clock" },
      line: "Sat 10 Oct · opens 8am Mon",
    })
  })

  test("a paused shop says Paused and until when", () => {
    const paused = { ...SHOP, pauses: [{ starts_at: lagos("2026-10-05T09:00:00").toISOString(), ends_at: lagos("2026-10-05T15:00:00").toISOString() }] }
    expect(vendorShopState(paused, lagos("2026-10-05T10:00:00"))).toEqual({
      chip: { label: "Paused", tone: "neutral", icon: "clock" },
      line: "Mon 5 Oct · paused until 3pm",
    })
  })

  test("a pause with no end is paused until resumed", () => {
    const paused = { ...SHOP, pauses: [{ starts_at: lagos("2026-10-05T09:00:00").toISOString(), ends_at: null }] }
    expect(vendorShopState(paused, lagos("2026-10-05T10:00:00")).line).toBe("Mon 5 Oct · paused")
  })

  test("a shop closed for an exception says Closed and when it reopens", () => {
    const away = { ...SHOP, exceptions: [{ starts_on: "2026-10-05", ends_on: "2026-10-06", closed: true, periods: [], note: null }] }
    expect(vendorShopState(away, lagos("2026-10-05T10:00:00"))).toEqual({
      chip: { label: "Closed", tone: "neutral", icon: "clock" },
      line: "Mon 5 Oct · closed until 8am Wed",
    })
  })
})
