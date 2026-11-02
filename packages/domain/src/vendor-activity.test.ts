import { describe, expect, test } from "bun:test"
import type { ShopHours } from "./shop-hours"
import { liveActivityPayloadBytes, MAX_ACTIVITY_CONTENT_BYTES } from "./buyer-activity"
import {
  nearestAcceptDeadline,
  vendorActivityAlert,
  vendorActivityContent,
  vendorActivitySellerId,
  vendorActivityUpdateDue,
  vendorActivityUrl,
  VENDOR_ACTIVITY_FACTORY,
  type VendorActivityContent,
} from "./vendor-activity"

const COUNTS = { new: 2, picking: 1, ready: 3, out: 4 }

describe("vendorActivityUrl", () => {
  test("opens the shop's orders, and names the shop for the phone to read back", () => {
    const url = vendorActivityUrl("ojavendor", "sel_1")
    expect(url).toBe("ojavendor://shop-orders/sel_1")
    expect(vendorActivitySellerId(url)).toBe("sel_1")
  })

  test("names no shop in a url that isn't a shop's", () => {
    expect(vendorActivitySellerId("oja://order/group_1?shop_order=order_1")).toBeNull()
    expect(vendorActivitySellerId(null)).toBeNull()
  })
})

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

describe("vendorActivityUpdateDue", () => {
  const now = new Date("2026-11-02T10:00:00.000Z")
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000)
  const current: VendorActivityContent = { shop: "Iya Bisi", counts: COUNTS, deadline: "2026-11-02T14:00:00.000Z", urgent: false }

  test("nothing has been sent yet: anything shown is news", () => {
    expect(vendorActivityUpdateDue(null, current, now)).toBe(true)
  })

  test("nothing changed: nothing to send, however long it has been", () => {
    expect(vendorActivityUpdateDue({ content: { ...current, counts: { ...COUNTS } }, at: ago(3600) }, current, now)).toBe(false)
  })

  test("the same content in another key order, as Postgres hands back JSON, hasn't changed", () => {
    const stored = { urgent: false, deadline: current.deadline, counts: { out: 4, ready: 3, picking: 1, new: 2 }, shop: "Iya Bisi" }
    expect(vendorActivityUpdateDue({ content: stored, at: ago(3600) }, current, now)).toBe(false)
  })

  test("a count, the deadline or the urgency changed: due", () => {
    const sent = { content: current, at: ago(60) }
    expect(vendorActivityUpdateDue(sent, { ...current, counts: { ...COUNTS, ready: 4 } }, now)).toBe(true)
    expect(vendorActivityUpdateDue(sent, { ...current, deadline: "2026-11-02T15:00:00.000Z" }, now)).toBe(true)
    expect(vendorActivityUpdateDue(sent, { ...current, deadline: null }, now)).toBe(true)
    expect(vendorActivityUpdateDue(sent, { ...current, urgent: true }, now)).toBe(true)
  })

  test("a change waits until 30 seconds after the last push", () => {
    const changed = { ...current, counts: { ...COUNTS, ready: 4 } }
    expect(vendorActivityUpdateDue({ content: current, at: ago(29) }, changed, now)).toBe(false)
    expect(vendorActivityUpdateDue({ content: current, at: ago(30) }, changed, now)).toBe(true)
  })
})

describe("vendorActivityAlert", () => {
  const content: VendorActivityContent = { shop: "Iya Bisi", counts: { ...COUNTS, new: 1 }, deadline: "2026-11-02T14:00:00.000Z", urgent: true }

  test("a new order says how many are waiting", () => {
    expect(vendorActivityAlert("new_order", content)).toEqual({ title: "Iya Bisi", body: "New order. 1 waiting to accept." })
    expect(vendorActivityAlert("new_order", { ...content, counts: COUNTS })).toEqual({ title: "Iya Bisi", body: "New order. 2 waiting to accept." })
  })

  test("the last two hours says what the drawing's label says", () => {
    expect(vendorActivityAlert("deadline_near", content)).toEqual({ title: "Iya Bisi", body: "An order has under 2 hours to accept." })
  })

  test("has no sound: the shop's own pushes carry the alarm", () => {
    expect(vendorActivityAlert("new_order", content)).not.toHaveProperty("sound")
  })
})
