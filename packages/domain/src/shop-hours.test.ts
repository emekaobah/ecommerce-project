import { describe, expect, test } from "bun:test"
import {
  afterOpenTime,
  shopStatusChip,
  hoursExceptionErrors,
  isOpenAt,
  weeklyHoursErrors,
  isOrderable,
  nextOpening,
  openingLabel,
  openTimeBetween,
  shopStatus,
  shopStatusLabel,
  todaysHours,
  type ShopHours,
  type ShopStatus,
} from "./shop-hours"

// Weeks in October 2026: Monday 5, Monday 12. Lagos is UTC+1 all year.
const lagos = (local: string) => new Date(`${local}+01:00`)

const weekdays = [{ opens: "08:00", closes: "18:00" }]
const SHOP: ShopHours = {
  time_zone: "Africa/Lagos",
  weekly: {
    mon: weekdays,
    tue: weekdays,
    wed: weekdays,
    thu: weekdays,
    fri: weekdays,
    sat: [{ opens: "09:00", closes: "14:00" }],
    sun: [],
  },
  exceptions: [],
  pauses: [],
}

describe("isOpenAt", () => {
  test.each([
    ["Monday mid-morning", "2026-10-05T10:00:00", true],
    ["Monday at opening", "2026-10-05T08:00:00", true],
    ["Monday a minute before opening", "2026-10-05T07:59:00", false],
    ["Monday at closing", "2026-10-05T18:00:00", false],
    ["Saturday noon", "2026-10-10T12:00:00", true],
    ["Saturday afternoon", "2026-10-10T15:00:00", false],
    ["Sunday noon", "2026-10-11T12:00:00", false],
  ])("weekly hours: %s → %p", (_, local, open) => {
    expect(isOpenAt(SHOP, lagos(local))).toBe(open)
  })

  // Closed Thursday 8 to Saturday 10 October for a family event.
  const away = { starts_on: "2026-10-08", ends_on: "2026-10-10", closed: true, periods: [], note: "Family event" }

  test.each([
    ["the day before", "2026-10-07T10:00:00", true],
    ["its first day", "2026-10-08T10:00:00", false],
    ["its middle day", "2026-10-09T10:00:00", false],
    ["its last day", "2026-10-10T10:00:00", false],
    ["the next open day", "2026-10-12T10:00:00", true],
  ])("a closed exception over several days: %s → %p", (_, local, open) => {
    expect(isOpenAt({ ...SHOP, exceptions: [away] }, lagos(local))).toBe(open)
  })

  test("special hours open the shop on a day it is normally closed, only during them", () => {
    const sundayMarket = {
      starts_on: "2026-10-11",
      ends_on: "2026-10-11",
      closed: false,
      periods: [{ opens: "10:00", closes: "16:00" }],
      note: null,
    }
    const shop = { ...SHOP, exceptions: [sundayMarket] }
    expect(isOpenAt(shop, lagos("2026-10-11T12:00:00"))).toBe(true)
    expect(isOpenAt(shop, lagos("2026-10-11T09:00:00"))).toBe(false)
    expect(isOpenAt(shop, lagos("2026-10-11T16:30:00"))).toBe(false)
  })

  test("special hours replace the day's regular hours", () => {
    const shortDay = {
      starts_on: "2026-10-06",
      ends_on: "2026-10-06",
      closed: false,
      periods: [{ opens: "12:00", closes: "15:00" }],
      note: null,
    }
    const shop = { ...SHOP, exceptions: [shortDay] }
    expect(isOpenAt(shop, lagos("2026-10-06T10:00:00"))).toBe(false)
    expect(isOpenAt(shop, lagos("2026-10-06T13:00:00"))).toBe(true)
  })

  test("a pause closes the shop from its start until it ends", () => {
    const pause = { starts_at: lagos("2026-10-05T11:00:00").toISOString(), ends_at: lagos("2026-10-06T09:00:00").toISOString() }
    const shop = { ...SHOP, pauses: [pause] }
    expect(isOpenAt(shop, lagos("2026-10-05T10:59:00"))).toBe(true)
    expect(isOpenAt(shop, lagos("2026-10-05T11:00:00"))).toBe(false)
    expect(isOpenAt(shop, lagos("2026-10-06T08:30:00"))).toBe(false)
    expect(isOpenAt(shop, lagos("2026-10-06T09:00:00"))).toBe(true)
  })

  test("a pause not yet resumed keeps the shop closed", () => {
    const shop = { ...SHOP, pauses: [{ starts_at: lagos("2026-10-05T11:00:00").toISOString(), ends_at: null }] }
    expect(isOpenAt(shop, lagos("2026-10-19T10:00:00"))).toBe(false)
  })
})

describe("nextOpening", () => {
  const next = (shop: ShopHours, local: string) => nextOpening(shop, lagos(local))?.toISOString() ?? null
  const at = (local: string) => lagos(local).toISOString()

  test.each([
    ["Monday before opening", "2026-10-05T06:30:00", "2026-10-05T08:00:00"],
    ["Friday evening, to Saturday's shorter hours", "2026-10-09T19:00:00", "2026-10-10T09:00:00"],
    ["Saturday afternoon, over the closed Sunday", "2026-10-10T15:00:00", "2026-10-12T08:00:00"],
  ])("weekly hours: %s", (_, local, opens) => {
    expect(next(SHOP, local)).toBe(at(opens))
  })

  test("is the instant itself while the shop is open", () => {
    expect(next(SHOP, "2026-10-05T10:00:00")).toBe(at("2026-10-05T10:00:00"))
  })

  test("skips every day of a closed exception", () => {
    const away = { starts_on: "2026-10-08", ends_on: "2026-10-12", closed: true, periods: [], note: null }
    expect(next({ ...SHOP, exceptions: [away] }, "2026-10-08T10:00:00")).toBe(at("2026-10-13T08:00:00"))
  })

  test("finds special hours on a normally closed day", () => {
    const sundayMarket = {
      starts_on: "2026-10-11",
      ends_on: "2026-10-11",
      closed: false,
      periods: [{ opens: "10:00", closes: "16:00" }],
      note: null,
    }
    expect(next({ ...SHOP, exceptions: [sundayMarket] }, "2026-10-10T15:00:00")).toBe(at("2026-10-11T10:00:00"))
  })

  test("a pause ending during opening hours reopens the shop when it ends", () => {
    const pause = { starts_at: at("2026-10-05T09:00:00"), ends_at: at("2026-10-05T13:00:00") }
    expect(next({ ...SHOP, pauses: [pause] }, "2026-10-05T10:00:00")).toBe(at("2026-10-05T13:00:00"))
  })

  test("a pause ending after hours reopens the shop at its next regular opening", () => {
    const pause = { starts_at: at("2026-10-05T09:00:00"), ends_at: at("2026-10-05T20:00:00") }
    expect(next({ ...SHOP, pauses: [pause] }, "2026-10-05T10:00:00")).toBe(at("2026-10-06T08:00:00"))
  })

  test("none while a pause hasn't been resumed", () => {
    const shop = { ...SHOP, pauses: [{ starts_at: at("2026-10-05T09:00:00"), ends_at: null }] }
    expect(next(shop, "2026-10-05T10:00:00")).toBeNull()
  })

  test("none for a shop with no opening hours at all", () => {
    const closed = { ...SHOP, weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } }
    expect(next(closed, "2026-10-05T10:00:00")).toBeNull()
  })

  test("reads the hours in the region's timezone", () => {
    // Nairobi is UTC+3: its 08:00 opening is 05:00 UTC, while Lagos (UTC+1) still has an hour to go.
    const nairobi = { ...SHOP, time_zone: "Africa/Nairobi" }
    expect(isOpenAt(nairobi, new Date("2026-10-05T05:30:00Z"))).toBe(true)
    expect(isOpenAt(SHOP, new Date("2026-10-05T05:30:00Z"))).toBe(false)
    expect(nextOpening(nairobi, new Date("2026-10-05T04:00:00Z"))?.toISOString()).toBe("2026-10-05T05:00:00.000Z")
  })

  test("keeps local opening times across a daylight-saving change", () => {
    // London's clocks go back early on Sunday 25 October 2026: 08:00 Monday is 08:00 GMT, not BST.
    const london = { ...SHOP, time_zone: "Europe/London" }
    expect(nextOpening(london, new Date("2026-10-24T14:00:00Z"))?.toISOString()).toBe("2026-10-26T08:00:00.000Z")
    expect(nextOpening(london, new Date("2026-10-24T06:00:00Z"))?.toISOString()).toBe("2026-10-24T08:00:00.000Z")
  })
})

const HOUR = 60 * 60 * 1000

describe("openTimeBetween", () => {
  const between = (shop: ShopHours, from: string, to: string) => openTimeBetween(shop, lagos(from), lagos(to)) / HOUR

  test("counts only opening hours over a weekend", () => {
    // Friday 17:00–18:00, Saturday 09:00–14:00, Monday 08:00–09:00.
    expect(between(SHOP, "2026-10-09T17:00:00", "2026-10-12T09:00:00")).toBe(7)
  })

  test("is nothing while the shop is closed, or for an interval that ends before it starts", () => {
    expect(between(SHOP, "2026-10-10T15:00:00", "2026-10-11T23:00:00")).toBe(0)
    expect(between(SHOP, "2026-10-06T12:00:00", "2026-10-05T12:00:00")).toBe(0)
  })

  test("leaves out a pause", () => {
    // Monday 08:00 to Tuesday 18:00 is 20 open hours; paused Monday 12:00 to Tuesday 10:00.
    const pause = { starts_at: lagos("2026-10-05T12:00:00").toISOString(), ends_at: lagos("2026-10-06T10:00:00").toISOString() }
    expect(between(SHOP, "2026-10-05T08:00:00", "2026-10-06T18:00:00")).toBe(20)
    expect(between({ ...SHOP, pauses: [pause] }, "2026-10-05T08:00:00", "2026-10-06T18:00:00")).toBe(12)
  })

  test("stops at a pause that hasn't been resumed", () => {
    const shop = { ...SHOP, pauses: [{ starts_at: lagos("2026-10-05T12:00:00").toISOString(), ends_at: null }] }
    expect(between(shop, "2026-10-05T08:00:00", "2026-10-09T18:00:00")).toBe(4)
  })

  test("leaves out closed exceptions and counts special hours", () => {
    const shop = {
      ...SHOP,
      exceptions: [
        { starts_on: "2026-10-12", ends_on: "2026-10-12", closed: true, periods: [], note: "Public holiday" },
        { starts_on: "2026-10-11", ends_on: "2026-10-11", closed: false, periods: [{ opens: "10:00", closes: "12:00" }], note: null },
      ],
    }
    // Saturday 5 + Sunday's special 2 + Monday's holiday 0 + Tuesday 08:00–09:00 1.
    expect(between(shop, "2026-10-10T00:00:00", "2026-10-13T09:00:00")).toBe(8)
  })

  test("counts the hours in the region's timezone", () => {
    // Friday 15:00–17:00 UTC is 18:00–20:00 in Nairobi (closed) but 16:00–18:00 in Lagos (open).
    const from = new Date("2026-10-09T15:00:00Z")
    const to = new Date("2026-10-09T17:00:00Z")
    expect(openTimeBetween(SHOP, from, to) / HOUR).toBe(2)
    expect(openTimeBetween({ ...SHOP, time_zone: "Africa/Nairobi" }, from, to) / HOUR).toBe(0)
  })
})

describe("afterOpenTime", () => {
  test("is when the given open time has passed, skipping closed hours", () => {
    // From Friday 17:00, 24 open hours: Friday 1, Saturday 5, Monday 10, then 8 on Tuesday.
    expect(afterOpenTime(SHOP, lagos("2026-10-09T17:00:00"), 24 * HOUR)?.toISOString()).toBe(lagos("2026-10-13T16:00:00").toISOString())
  })

  test("counts from the next opening when it starts while closed", () => {
    expect(afterOpenTime(SHOP, lagos("2026-10-10T20:00:00"), 2 * HOUR)?.toISOString()).toBe(lagos("2026-10-12T10:00:00").toISOString())
  })

  test("waits out a pause", () => {
    const pause = { starts_at: lagos("2026-10-05T09:00:00").toISOString(), ends_at: lagos("2026-10-05T15:00:00").toISOString() }
    expect(afterOpenTime({ ...SHOP, pauses: [pause] }, lagos("2026-10-05T08:00:00"), 2 * HOUR)?.toISOString()).toBe(
      lagos("2026-10-05T16:00:00").toISOString()
    )
  })

  test("never comes while a pause hasn't been resumed (afterOpenTime)", () => {
    const shop = { ...SHOP, pauses: [{ starts_at: lagos("2026-10-05T09:00:00").toISOString(), ends_at: null }] }
    expect(afterOpenTime(shop, lagos("2026-10-05T08:00:00"), 2 * HOUR)).toBeNull()
  })
})

describe("shopStatus", () => {
  const iso = (local: string) => lagos(local).toISOString()
  const away = { starts_on: "2026-10-08", ends_on: "2026-10-10", closed: true, periods: [], note: "Family event" }

  test("open during its hours, with when it closes today", () => {
    expect(shopStatus(SHOP, lagos("2026-10-05T10:00:00"))).toEqual({ state: "open", closes_at: iso("2026-10-05T18:00:00") })
  })

  test("open past midnight: closes when the hours running on into the next day end", () => {
    const lateNights = { ...SHOP.weekly, fri: [{ opens: "18:00", closes: "24:00" }], sat: [{ opens: "00:00", closes: "02:00" }] }
    expect(shopStatus({ ...SHOP, weekly: lateNights }, lagos("2026-10-09T23:00:00"))).toEqual({
      state: "open",
      closes_at: iso("2026-10-10T02:00:00"),
    })
  })

  test("a day's special hours set its closing time", () => {
    const longDay = { starts_on: "2026-10-06", ends_on: "2026-10-06", closed: false, periods: [{ opens: "08:00", closes: "21:00" }], note: null }
    expect(shopStatus({ ...SHOP, exceptions: [longDay] }, lagos("2026-10-06T10:00:00"))).toEqual({
      state: "open",
      closes_at: iso("2026-10-06T21:00:00"),
    })
  })

  test("a pause starting later today closes it then", () => {
    const pause = { starts_at: iso("2026-10-05T15:00:00"), ends_at: iso("2026-10-05T16:00:00") }
    expect(shopStatus({ ...SHOP, pauses: [pause] }, lagos("2026-10-05T10:00:00"))).toEqual({
      state: "open",
      closes_at: iso("2026-10-05T15:00:00"),
    })
  })

  test("open round the clock: no closing time", () => {
    const always = Object.fromEntries(Object.keys(SHOP.weekly).map((day) => [day, [{ opens: "00:00", closes: "24:00" }]])) as ShopHours["weekly"]
    expect(shopStatus({ ...SHOP, weekly: always }, lagos("2026-10-05T10:00:00"))).toEqual({ state: "open", closes_at: null })
  })

  test("outside regular hours: closed, with when it opens, and still taking orders", () => {
    const status = shopStatus(SHOP, lagos("2026-10-10T15:00:00"))
    expect(status).toEqual({ state: "closed", opens_at: iso("2026-10-12T08:00:00") })
    expect(isOrderable(status)).toBe(true)
  })

  test("outside a day's special hours counts as outside its hours", () => {
    const shortDay = { starts_on: "2026-10-06", ends_on: "2026-10-06", closed: false, periods: [{ opens: "12:00", closes: "15:00" }], note: "Stocktake" }
    expect(shopStatus({ ...SHOP, exceptions: [shortDay] }, lagos("2026-10-06T10:00:00"))).toEqual({
      state: "closed",
      opens_at: iso("2026-10-06T12:00:00"),
    })
  })

  test("during a closed exception: closed until it next opens, with the note, and not taking orders", () => {
    const status = shopStatus({ ...SHOP, exceptions: [away] }, lagos("2026-10-09T10:00:00"))
    expect(status).toEqual({ state: "closed_until", reason: "exception", until: iso("2026-10-12T08:00:00"), note: "Family event" })
    expect(isOrderable(status)).toBe(false)
  })

  test("a closed exception still to come doesn't close the shop yet", () => {
    expect(shopStatus({ ...SHOP, exceptions: [away] }, lagos("2026-10-07T10:00:00"))).toEqual({
      state: "open",
      closes_at: iso("2026-10-07T18:00:00"),
    })
  })

  test("paused: closed until the pause ends and the shop next opens, not taking orders", () => {
    const pause = { starts_at: iso("2026-10-05T09:00:00"), ends_at: iso("2026-10-05T20:00:00"), note: "Power cut" }
    const status = shopStatus({ ...SHOP, pauses: [pause] }, lagos("2026-10-05T10:00:00"))
    expect(status).toEqual({ state: "closed_until", reason: "pause", until: iso("2026-10-06T08:00:00"), note: "Power cut" })
    expect(isOrderable(status)).toBe(false)
  })

  test("paused outside opening hours is still paused", () => {
    const pause = { starts_at: iso("2026-10-05T19:00:00"), ends_at: null }
    expect(shopStatus({ ...SHOP, pauses: [pause] }, lagos("2026-10-05T21:00:00"))).toEqual({
      state: "closed_until",
      reason: "pause",
      until: null,
      note: null,
    })
  })

  test("a pause that has ended no longer counts", () => {
    const pause = { starts_at: iso("2026-10-05T09:00:00"), ends_at: iso("2026-10-05T09:30:00") }
    expect(shopStatus({ ...SHOP, pauses: [pause] }, lagos("2026-10-05T10:00:00"))).toEqual({
      state: "open",
      closes_at: iso("2026-10-05T18:00:00"),
    })
  })
})

describe("todaysHours", () => {
  const iso = (local: string) => lagos(local).toISOString()

  test("a regular day: its weekday's hours", () => {
    expect(todaysHours(SHOP, lagos("2026-10-05T10:00:00"))).toEqual({
      date: "2026-10-05",
      periods: [{ opens: "08:00", closes: "18:00" }],
      closure: null,
    })
  })

  test("a day it doesn't open: no hours, and no closure", () => {
    expect(todaysHours(SHOP, lagos("2026-10-11T10:00:00"))).toEqual({ date: "2026-10-11", periods: [], closure: null })
  })

  test("a day it closed: no hours, with the closure's note", () => {
    const away = { starts_on: "2026-10-04", ends_on: "2026-10-06", closed: true, periods: [], note: "Family event" }
    expect(todaysHours({ ...SHOP, exceptions: [away] }, lagos("2026-10-05T10:00:00"))).toEqual({
      date: "2026-10-05",
      periods: [],
      closure: { reason: "exception", note: "Family event" },
    })
  })

  test("a day of special hours: those hours", () => {
    const shortDay = { starts_on: "2026-10-05", ends_on: "2026-10-05", closed: false, periods: [{ opens: "12:00", closes: "15:00" }], note: "Stocktake" }
    expect(todaysHours({ ...SHOP, exceptions: [shortDay] }, lagos("2026-10-05T10:00:00")).periods).toEqual([{ opens: "12:00", closes: "15:00" }])
  })

  test("a pause today: the hours it leaves open, with the pause's note", () => {
    const pause = { starts_at: iso("2026-10-05T09:00:00"), ends_at: iso("2026-10-05T11:30:00"), note: "Power cut" }
    expect(todaysHours({ ...SHOP, pauses: [pause] }, lagos("2026-10-05T10:00:00"))).toEqual({
      date: "2026-10-05",
      periods: [
        { opens: "08:00", closes: "09:00" },
        { opens: "11:30", closes: "18:00" },
      ],
      closure: { reason: "pause", note: "Power cut" },
    })
  })

  test("a pause on another day doesn't touch today", () => {
    const pause = { starts_at: iso("2026-10-06T09:00:00"), ends_at: null }
    expect(todaysHours({ ...SHOP, pauses: [pause] }, lagos("2026-10-05T10:00:00")).closure).toBeNull()
  })

  test("hours running to midnight end at 24:00", () => {
    const late = { ...SHOP.weekly, mon: [{ opens: "18:00", closes: "24:00" }] }
    expect(todaysHours({ ...SHOP, weekly: late }, lagos("2026-10-05T10:00:00")).periods).toEqual([{ opens: "18:00", closes: "24:00" }])
  })
})

describe("shopStatusLabel", () => {
  const now = lagos("2026-10-05T19:00:00") // Monday evening
  const label = (status: ShopStatus) => shopStatusLabel(status, now, "Africa/Lagos")

  test.each([
    ["later today", "2026-10-05T21:30:00", "Closed · opens 9:30pm"],
    ["tomorrow", "2026-10-06T08:00:00", "Closed · opens 8am Tue"],
    ["at noon this week", "2026-10-10T12:00:00", "Closed · opens 12pm Sat"],
    ["more than a week away", "2026-10-13T08:00:00", "Closed · opens 8am Tue 13 Oct"],
  ])("closed, opening %s", (_, local, text) => {
    expect(label({ state: "closed", opens_at: lagos(local).toISOString() })).toBe(text)
  })

  test("closed until a day", () => {
    expect(label({ state: "closed_until", reason: "exception", until: lagos("2026-10-13T08:00:00").toISOString(), note: null })).toBe(
      "Closed until Tue 13 Oct"
    )
  })

  test("closed until later today", () => {
    expect(label({ state: "closed_until", reason: "pause", until: lagos("2026-10-05T21:00:00").toISOString(), note: null })).toBe(
      "Closed until 9pm"
    )
  })

  test("closed with no reopening set", () => {
    expect(label({ state: "closed_until", reason: "pause", until: null, note: null })).toBe("Closed until further notice")
    expect(label({ state: "closed", opens_at: null })).toBe("Closed")
  })

  test.each([
    ["later today", "2026-10-05T21:30:00", "Open · closes 9:30pm"],
    ["at midnight", "2026-10-06T00:00:00", "Open · closes midnight"],
    ["after midnight", "2026-10-06T02:00:00", "Open · closes 2am Tue"],
  ])("open, closing %s", (_, local, text) => {
    expect(label({ state: "open", closes_at: lagos(local).toISOString() })).toBe(text)
  })

  test("open round the clock", () => {
    expect(label({ state: "open", closes_at: null })).toBe("Open")
  })
})

describe("weeklyHoursErrors", () => {
  test("none for valid hours, including a day split in two and a day open until midnight", () => {
    const weekly = {
      ...SHOP.weekly,
      mon: [
        { opens: "08:00", closes: "12:00" },
        { opens: "13:00", closes: "18:00" },
      ],
      fri: [{ opens: "16:00", closes: "24:00" }],
    }
    expect(weeklyHoursErrors(weekly)).toEqual([])
  })

  test("a shop must open on at least one day", () => {
    expect(weeklyHoursErrors({ mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] })).toEqual([
      "Add the hours you're open on at least one day",
    ])
  })

  test.each([
    ["a time that isn't HH:MM", { opens: "8am", closes: "18:00" }, "Monday: enter times as HH:MM, e.g. 08:00"],
    ["an hour past midnight", { opens: "08:00", closes: "24:30" }, "Monday: enter times as HH:MM, e.g. 08:00"],
    ["closing before opening", { opens: "18:00", closes: "08:00" }, "Monday: closing time must be after opening time"],
    ["closing as it opens", { opens: "08:00", closes: "08:00" }, "Monday: closing time must be after opening time"],
  ])("refuses %s", (_, period, error) => {
    expect(weeklyHoursErrors({ ...SHOP.weekly, mon: [period] })).toEqual([error])
  })

  test("refuses periods that overlap", () => {
    const tue = [
      { opens: "08:00", closes: "13:00" },
      { opens: "12:00", closes: "18:00" },
    ]
    expect(weeklyHoursErrors({ ...SHOP.weekly, tue })).toEqual(["Tuesday: opening times overlap"])
  })
})

describe("hoursExceptionErrors", () => {
  test("none for a closed range or a day with special hours", () => {
    expect(hoursExceptionErrors({ starts_on: "2026-12-24", ends_on: "2026-12-26", closed: true, periods: [], note: "Christmas" })).toEqual(
      []
    )
    expect(
      hoursExceptionErrors({ starts_on: "2026-12-27", ends_on: "2026-12-27", closed: false, periods: [{ opens: "10:00", closes: "14:00" }], note: null })
    ).toEqual([])
  })

  test("refuses a range that ends before it starts, or dates that aren't real", () => {
    expect(hoursExceptionErrors({ starts_on: "2026-12-26", ends_on: "2026-12-24", closed: true, periods: [], note: null })).toEqual([
      "The last day can't be before the first",
    ])
    expect(hoursExceptionErrors({ starts_on: "2026-02-30", ends_on: "2026-03-01", closed: true, periods: [], note: null })).toEqual([
      "Enter dates as YYYY-MM-DD",
    ])
  })

  test("special hours need at least one valid period", () => {
    expect(hoursExceptionErrors({ starts_on: "2026-12-27", ends_on: "2026-12-27", closed: false, periods: [], note: null })).toEqual([
      "Add the special hours, or mark the days closed",
    ])
    expect(
      hoursExceptionErrors({ starts_on: "2026-12-27", ends_on: "2026-12-27", closed: false, periods: [{ opens: "14:00", closes: "10:00" }], note: null })
    ).toEqual(["Closing time must be after opening time"])
  })
})

describe("openingLabel", () => {
  const now = lagos("2026-10-05T19:00:00") // Monday evening

  test.each([
    ["later today", "2026-10-05T21:30:00", "9:30pm"],
    ["tomorrow", "2026-10-06T08:00:00", "8am Tue"],
    ["more than a week away", "2026-10-13T08:00:00", "8am Tue 13 Oct"],
  ])("a shop opening %s", (_, local, text) => {
    expect(openingLabel(lagos(local).toISOString(), now, "Africa/Lagos")).toBe(text)
  })
})

describe("shopStatusChip", () => {
  test("an open shop's chip is leaf, with a check", () => {
    expect(shopStatusChip("open", "Open · closes 7pm")).toEqual({ label: "Open · closes 7pm", tone: "success", icon: "check" })
  })

  test.each(["closed", "closed_until"] as const)("a %s shop's chip is grey, with a clock", (state) => {
    expect(shopStatusChip(state, "Closed · opens 10am Mon")).toEqual({ label: "Closed · opens 10am Mon", tone: "neutral", icon: "clock" })
  })
})
