import { describe, expect, test } from "bun:test"
import { pauseDurations, pauseWaitingMessage, takingOrdersLine } from "./pause-duration"
import type { ShopHours } from "./shop-hours"

// Lagos is UTC+1 all year. Fri 23 Oct 2026.
const lagos = (local: string) => new Date(`${local}+01:00`)
const iso = (local: string) => lagos(local).toISOString()

const day = [{ opens: "08:00", closes: "19:00" }]
const SHOP: ShopHours = {
  time_zone: "Africa/Lagos",
  weekly: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: [] },
  exceptions: [],
  pauses: [],
}

describe("pauseDurations", () => {
  test("open now: an hour, until it next opens after closing, or until turned back on", () => {
    expect(pauseDurations(lagos("2026-10-23T14:47:00"), SHOP, "Africa/Lagos")).toEqual([
      { key: "hour", label: "1 hour · until 3:47pm", until: iso("2026-10-23T15:47:00") },
      { key: "next_opening", label: "Until tomorrow, 8am", until: iso("2026-10-24T08:00:00") },
      { key: "resume", label: "I turn it back on", until: null },
    ])
  })

  test("closed for the night: until it opens next", () => {
    const [, next] = pauseDurations(lagos("2026-10-23T21:00:00"), SHOP, "Africa/Lagos")
    expect(next).toEqual({ key: "next_opening", label: "Until tomorrow, 8am", until: iso("2026-10-24T08:00:00") })
  })

  test("after midnight, the next opening is later today", () => {
    const [, next] = pauseDurations(lagos("2026-10-24T01:00:00"), SHOP, "Africa/Lagos")
    expect(next?.label).toBe("Until today, 8am")
  })

  test("a next opening days away names its weekday", () => {
    // Saturday evening: closed Sunday, opens Monday.
    const [, next] = pauseDurations(lagos("2026-10-24T18:30:00"), SHOP, "Africa/Lagos")
    expect(next).toEqual({ key: "next_opening", label: "Until Mon, 8am", until: iso("2026-10-26T08:00:00") })
  })

  test("a shop without hours, or open round the clock, has no next opening to pause until", () => {
    const always: ShopHours = { ...SHOP, weekly: Object.fromEntries(Object.keys(SHOP.weekly).map((d) => [d, [{ opens: "00:00", closes: "24:00" }]])) as ShopHours["weekly"] }
    const keys = (hours: ShopHours | null) => pauseDurations(lagos("2026-10-23T14:47:00"), hours, "Africa/Lagos").map((d) => d.key)
    expect(keys(null)).toEqual(["hour", "resume"])
    expect(keys(always)).toEqual(["hour", "resume"])
  })

  test("the hour reads in the shop's time zone", () => {
    expect(pauseDurations(new Date("2026-10-23T13:47:00Z"), null, "Africa/Lagos")[0]?.label).toBe("1 hour · until 3:47pm")
  })
})

describe("takingOrdersLine", () => {
  const now = lagos("2026-10-23T14:00:00")

  test("taking orders: how to pause", () => {
    expect(takingOrdersLine({ time_zone: "Africa/Lagos", pause: null }, now)).toBe("Turn off to pause the shop now")
  })

  test("paused until a time, with what buyers read", () => {
    const pause = { ends_at: iso("2026-10-24T08:00:00"), note: "Back after the market run" }
    expect(takingOrdersLine({ time_zone: "Africa/Lagos", pause }, now)).toBe(
      "Paused until 8am Sat. Buyers see: “Back after the market run”"
    )
  })

  test("paused until turned back on, without a note", () => {
    expect(takingOrdersLine({ time_zone: "Africa/Lagos", pause: { ends_at: null, note: null } }, now)).toBe("Paused until you turn it back on.")
  })
})

describe("pauseWaitingMessage", () => {
  test("one order waiting", () => {
    expect(pauseWaitingMessage(1)).toBe(
      "1 new order is still waiting to be accepted. Pausing stops new orders, not this one: accept or reject it, or it'll be rejected at its deadline."
    )
  })

  test("several waiting, as the catalogue says it", () => {
    expect(pauseWaitingMessage(2)).toBe(
      "2 new orders are still waiting to be accepted. Pausing stops new orders, not these: accept or reject them, or they'll be rejected at their deadline."
    )
  })
})
