import { describe, expect, test } from "bun:test"
import type { ShopHours } from "./shop-hours"
import { liveActivityPayloadBytes, MAX_ACTIVITY_CONTENT_BYTES } from "./buyer-activity"
import { nearestAcceptDeadline, vendorActivityContent, VENDOR_ACTIVITY_FACTORY } from "./vendor-activity"

const COUNTS = { new: 2, picking: 1, ready: 3, out: 4 }

describe("vendorActivityContent", () => {
  test("carries the shop's name, its four stage counts and the nearest deadline with its urgency", () => {
    expect(
      vendorActivityContent({
        shop: "Iya Bisi Foodstuff",
        counts: COUNTS,
        deadline: { at: "2026-11-02T14:00:00.000Z", urgent: true },
      })
    ).toEqual({
      shop: "Iya Bisi Foodstuff",
      counts: COUNTS,
      deadline: "2026-11-02T14:00:00.000Z",
      urgent: true,
    })
  })

  test("with no order to accept there is no deadline, and nothing is urgent", () => {
    const content = vendorActivityContent({ shop: "Iya Bisi", counts: { ...COUNTS, new: 0 }, deadline: null })
    expect(content.deadline).toBeNull()
    expect(content.urgent).toBe(false)
  })

  test("a very long shop name still fits Apple's limit", () => {
    const content = vendorActivityContent({ shop: "ẞ".repeat(2000), counts: COUNTS, deadline: null })
    expect(content.shop.length).toBeLessThanOrEqual(80)
    expect(liveActivityPayloadBytes(VENDOR_ACTIVITY_FACTORY, content)).toBeLessThanOrEqual(MAX_ACTIVITY_CONTENT_BYTES)
  })
})

describe("nearestAcceptDeadline", () => {
  const now = new Date("2026-11-02T10:00:00.000Z")

  test("no new orders: nothing to count down to", () => {
    expect(nearestAcceptDeadline([], now, null)).toBeNull()
  })

  test("the soonest of the new orders' deadlines; without hours, 24 hours from when each was placed", () => {
    expect(nearestAcceptDeadline(["2026-11-02T09:00:00.000Z", "2026-11-02T06:00:00.000Z"], now, null)).toEqual({
      at: "2026-11-03T06:00:00.000Z",
      urgent: false,
    })
  })

  test("urgent in the last two hours, as the time chip is", () => {
    expect(nearestAcceptDeadline(["2026-11-01T11:30:00.000Z"], now, null)).toEqual({
      at: "2026-11-02T11:30:00.000Z",
      urgent: true,
    })
    expect(nearestAcceptDeadline(["2026-11-01T12:30:00.000Z"], now, null)?.urgent).toBe(false)
  })

  test("counts the shop's open hours: closed hours don't run the clock down", () => {
    const nineToFive = { opens: "09:00", closes: "17:00" }
    const hours: ShopHours = {
      time_zone: "UTC",
      weekly: { mon: [nineToFive], tue: [nineToFive], wed: [nineToFive], thu: [nineToFive], fri: [nineToFive], sat: [nineToFive], sun: [nineToFive] },
      exceptions: [],
      pauses: [],
    }
    // Placed at 10:00 on the 2nd, with 8 open hours a day: 24 open hours end at 10:00 on the 5th.
    expect(nearestAcceptDeadline(["2026-11-02T10:00:00.000Z"], now, hours)).toEqual({ at: "2026-11-05T10:00:00.000Z", urgent: false })
  })

  test("a shop that doesn't reopen to finish the clock has no deadline to show", () => {
    const hours: ShopHours = {
      time_zone: "UTC",
      weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      exceptions: [],
      pauses: [],
    }
    expect(nearestAcceptDeadline(["2026-11-02T09:00:00.000Z"], now, hours)).toBeNull()
  })
})
