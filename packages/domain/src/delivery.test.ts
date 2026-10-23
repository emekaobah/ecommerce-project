import { describe, expect, test } from "bun:test"
import {
  courierChangedNote,
  deliveryChoices,
  deliveryDay,
  deliveryEstimate,
  deliveryStartsAt,
  etaCountedFrom,
  orderArrival,
  preparedWhenOpens,
} from "./delivery"
import type { ShopHours } from "./shop-hours"

const rate = (id: string, amount: number, delivery_eta_time: string, tracking_level = 5) => ({
  id,
  amount,
  delivery_eta_time,
  tracking_level,
})

describe("deliveryChoices", () => {
  const bike = rate("bike", 1800, "2026-10-07T12:00:00+01:00")
  const express = rate("express", 4200, "2026-10-05T15:00:00+01:00")
  const nextDay = rate("next-day", 2600, "2026-10-06T12:00:00+01:00")
  const slow = rate("slow", 3000, "2026-10-09T12:00:00+01:00")

  test("offers the best value, the cheapest and the fastest, best value first", () => {
    expect(deliveryChoices([slow, bike, express, nextDay]).map((c) => [c.id, c.tags])).toEqual([
      ["next-day", ["best_value"]],
      ["bike", ["cheapest"]],
      ["express", ["fastest"]],
    ])
  })

  test("best value is the cheapest rate arriving within a day of the fastest", () => {
    const almostAsFast = rate("almost", 2000, "2026-10-06T14:00:00+01:00")
    expect(deliveryChoices([bike, express, almostAsFast]).find((c) => c.tags.includes("best_value"))?.id).toBe(
      "almost"
    )
  })

  test("among equally priced rates, best value goes to the better-tracked one", () => {
    const tracked = rate("tracked", 2600, "2026-10-06T13:00:00+01:00", 9)
    expect(deliveryChoices([nextDay, tracked, express]).find((c) => c.tags.includes("best_value"))?.id).toBe(
      "tracked"
    )
  })

  test("one rate that is all three is offered once with every tag", () => {
    expect(deliveryChoices([bike])).toEqual([{ ...bike, tags: ["best_value", "cheapest", "fastest"] }])
  })

  test("the fastest also being the best value is offered once", () => {
    expect(deliveryChoices([express, bike]).map((c) => [c.id, c.tags])).toEqual([
      ["express", ["best_value", "fastest"]],
      ["bike", ["cheapest"]],
    ])
  })

  test("no rates, no choices", () => {
    expect(deliveryChoices([])).toEqual([])
  })
})

describe("deliveryDay", () => {
  const now = new Date("2026-10-04T09:00:00+01:00")
  const lagos = "Africa/Lagos"

  test.each([
    ["later today", "2026-10-04T18:00:00+01:00", "Today"],
    ["tomorrow", "2026-10-05T12:00:00+01:00", "Tomorrow"],
    ["a later date by weekday and date", "2026-10-07T12:00:00+01:00", "Wed 7 Oct"],
  ])("names %s, as a courier option's title does", (_, eta, label) => {
    expect(deliveryDay(eta, now, lagos)).toBe(label)
  })
})

describe("preparedWhenOpens", () => {
  const now = new Date("2026-10-03T20:00:00+01:00")

  test("says when a closed shop prepares the order", () => {
    expect(preparedWhenOpens("2026-10-05T10:00:00+01:00", now, "Africa/Lagos")).toBe("Prepared when it opens 10am Mon")
  })

  test("says only that it's prepared at opening when the time isn't known", () => {
    expect(preparedWhenOpens(null, now, "Africa/Lagos")).toBe("Prepared when it opens")
  })
})

describe("deliveryEstimate", () => {
  const now = new Date("2026-10-04T09:00:00+01:00")
  const lagos = "Africa/Lagos"

  test.each([
    ["later today", "2026-10-04T18:00:00+01:00", "Arrives today"],
    ["tomorrow", "2026-10-05T12:00:00+01:00", "Arrives tomorrow"],
    ["a later date by weekday and date", "2026-10-07T12:00:00+01:00", "Arrives Wed 7 Oct"],
  ])("reads %s", (_, eta, label) => {
    expect(deliveryEstimate(eta, now, lagos)).toBe(label)
  })

  test("counts days in the region's timezone, not the device's", () => {
    // 23:30 in Lagos is already the next day in UTC+2 but not in Lagos.
    expect(deliveryEstimate("2026-10-04T23:30:00+01:00", now, lagos)).toBe("Arrives today")
  })
})

describe("deliveryStartsAt", () => {
  // Weeks in October 2026: Monday 5. Lagos is UTC+1 all year.
  const lagos = (local: string) => new Date(`${local}+01:00`)
  const weekdays = [{ opens: "08:00", closes: "18:00" }]
  const shop: ShopHours = {
    time_zone: "Africa/Lagos",
    weekly: { mon: weekdays, tue: weekdays, wed: weekdays, thu: weekdays, fri: weekdays, sat: [], sun: [] },
    exceptions: [],
    pauses: [],
  }

  test("an order placed while the shop is open starts now", () => {
    expect(deliveryStartsAt(shop, lagos("2026-10-05T10:00:00"))).toEqual(lagos("2026-10-05T10:00:00"))
  })

  test("an order placed outside hours starts at the next opening", () => {
    expect(deliveryStartsAt(shop, lagos("2026-10-05T21:00:00"))).toEqual(lagos("2026-10-06T08:00:00"))
    // Friday night waits for Monday morning.
    expect(deliveryStartsAt(shop, lagos("2026-10-09T19:30:00"))).toEqual(lagos("2026-10-12T08:00:00"))
  })

  test("an order placed in a closure starts when the shop reopens", () => {
    const closed = { ...shop, exceptions: [{ starts_on: "2026-10-06", ends_on: "2026-10-06", closed: true, periods: [], note: null }] }
    expect(deliveryStartsAt(closed, lagos("2026-10-05T21:00:00"))).toEqual(lagos("2026-10-07T08:00:00"))
  })

  test("a shop without hours, or not set to reopen, starts now", () => {
    const at = lagos("2026-10-05T21:00:00")
    expect(deliveryStartsAt(null, at)).toEqual(at)
    const paused = { ...shop, pauses: [{ starts_at: "2026-10-05T12:00:00+01:00", ends_at: null }] }
    expect(deliveryStartsAt(paused, at)).toEqual(at)
  })
})

describe("etaCountedFrom", () => {
  const opens = new Date("2026-10-06T08:00:00+01:00")

  test("moves a courier's ETA later by how long before the opening it would collect", () => {
    expect(etaCountedFrom("2026-10-06T12:00:00+01:00", "2026-10-05T21:00:00+01:00", opens)).toEqual(
      new Date("2026-10-06T23:00:00+01:00")
    )
  })

  test("leaves it as it is when the courier collects at the opening or after", () => {
    expect(etaCountedFrom("2026-10-07T12:00:00+01:00", "2026-10-06T08:00:00+01:00", opens)).toEqual(
      new Date("2026-10-07T12:00:00+01:00")
    )
    expect(etaCountedFrom("2026-10-08T08:00:00+01:00", "2026-10-07T08:00:00+01:00", opens)).toEqual(
      new Date("2026-10-08T08:00:00+01:00")
    )
  })

  test("leaves it as it is when the courier gives no collection time", () => {
    expect(etaCountedFrom("2026-10-06T12:00:00+01:00", null, opens)).toEqual(new Date("2026-10-06T12:00:00+01:00"))
    expect(etaCountedFrom("2026-10-06T12:00:00+01:00", undefined, opens)).toEqual(new Date("2026-10-06T12:00:00+01:00"))
  })
})

describe("orderArrival", () => {
  const now = new Date("2026-10-05T21:00:00+01:00")
  const delivery = { courier_name: "GIG Next Day", delivery_eta_time: "2026-10-07T11:00:00+01:00", time_zone: "Africa/Lagos", switched_from: null }

  test("says when a delivered order arrives, as checkout quoted, and by whom", () => {
    expect(orderArrival("new", delivery, now)).toBe("Arrives Wed 7 Oct · GIG Next Day")
    expect(orderArrival("in_transit", delivery, now)).toBe("Arrives Wed 7 Oct · GIG Next Day")
  })

  test("says nothing once it has arrived or won't, or for an order without a delivery", () => {
    for (const state of ["delivered", "rejected", "cancelled"] as const) expect(orderArrival(state, delivery, now)).toBeNull()
    expect(orderArrival("new", null, now)).toBeNull()
  })
})

describe("courierChangedNote", () => {
  const delivery = { courier_name: "Faramove Same Day", delivery_eta_time: "2026-10-07T11:00:00+01:00", time_zone: "Africa/Lagos" }

  test("says which courier the order now ships with instead of the buyer's, at no more cost to them", () => {
    expect(courierChangedNote("label_booked", { ...delivery, switched_from: "GIG Next Day" })).toBe(
      "Your order is now shipping with Faramove Same Day instead of GIG Next Day, at no extra cost to you."
    )
  })

  test("says nothing when the buyer's courier was booked, or once the order has arrived", () => {
    expect(courierChangedNote("label_booked", { ...delivery, switched_from: null })).toBeNull()
    expect(courierChangedNote("delivered", { ...delivery, switched_from: "GIG Next Day" })).toBeNull()
    expect(courierChangedNote("new", null)).toBeNull()
  })
})
