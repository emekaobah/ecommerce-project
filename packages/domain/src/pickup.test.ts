import { describe, expect, test } from "bun:test"
import { checkPickupCode, collectBy, collectByLabel, isPickupCodeFormat, openingHoursLines } from "./pickup"
import type { ShopHours } from "./shop-hours"

const now = new Date("2026-10-11T12:00:00.000Z")
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()

describe("checkPickupCode", () => {
  test("the order's own code checks out", () => {
    expect(checkPickupCode({ code: "482913", wrongAttempts: [] }, "482913", now)).toEqual({ ok: true })
  })

  test("a wrong code is refused and counted, with when it was tried", () => {
    expect(checkPickupCode({ code: "482913", wrongAttempts: [minutesAgo(3)] }, "111111", now)).toEqual({
      ok: false,
      reason: "wrong_code",
      wrongAttempts: [minutesAgo(3), now.toISOString()],
    })
  })

  test("after five wrong codes within 15 minutes even the right code is refused until the first falls out of the window", () => {
    const five = [14, 10, 6, 4, 1].map(minutesAgo)
    expect(checkPickupCode({ code: "482913", wrongAttempts: five }, "482913", now)).toEqual({
      ok: false,
      reason: "too_many_attempts",
      retryAt: new Date(new Date(five[0]!).getTime() + 15 * 60_000).toISOString(),
    })
  })

  test("wrong codes older than 15 minutes no longer count", () => {
    const old = [40, 30, 20, 16, 15].map(minutesAgo)
    expect(checkPickupCode({ code: "482913", wrongAttempts: old }, "482913", now)).toEqual({ ok: true })
    expect(checkPickupCode({ code: "482913", wrongAttempts: old }, "000000", now)).toEqual({
      ok: false,
      reason: "wrong_code",
      wrongAttempts: [now.toISOString()],
    })
  })

  test("an order with no code yet takes none", () => {
    expect(checkPickupCode({ code: null, wrongAttempts: [] }, "482913", now)).toEqual({
      ok: false,
      reason: "wrong_code",
      wrongAttempts: [now.toISOString()],
    })
  })
})

describe("openingHoursLines", () => {
  const day = (opens: string, closes: string) => [{ opens, closes }]

  test("groups days open the same hours, in week order, and says which days are closed", () => {
    expect(
      openingHoursLines({
        mon: day("07:00", "20:00"),
        tue: day("07:00", "20:00"),
        wed: day("07:00", "20:00"),
        thu: [],
        fri: day("07:00", "20:00"),
        sat: [
          { opens: "09:00", closes: "13:00" },
          { opens: "14:00", closes: "18:00" },
        ],
        sun: [],
      }),
    ).toEqual(["Mon–Wed 07:00–20:00", "Thu Closed", "Fri 07:00–20:00", "Sat 09:00–13:00, 14:00–18:00", "Sun Closed"])
  })

  test("a shop open round the clock every day reads as one line", () => {
    const always = day("00:00", "24:00")
    expect(openingHoursLines({ mon: always, tue: always, wed: always, thu: always, fri: always, sat: always, sun: always })).toEqual([
      "Mon–Sun Open 24 hours",
    ])
  })
})

describe("isPickupCodeFormat", () => {
  test("a pickup code is six digits", () => {
    expect(isPickupCodeFormat("012345")).toBe(true)
    expect(isPickupCodeFormat("12345")).toBe(false)
    expect(isPickupCodeFormat("1234567")).toBe(false)
    expect(isPickupCodeFormat("12a456")).toBe(false)
  })
})

describe("collectBy", () => {
  // Weekdays 08:00–18:00, Saturday 09:00–14:00, closed Sunday, in Lagos (UTC+1). Friday 9 October 2026.
  const weekdays = [{ opens: "08:00", closes: "18:00" }]
  const HOURS: ShopHours = {
    time_zone: "Africa/Lagos",
    weekly: { mon: weekdays, tue: weekdays, wed: weekdays, thu: weekdays, fri: weekdays, sat: [{ opens: "09:00", closes: "14:00" }], sun: [] },
    exceptions: [],
    pauses: [],
  }
  const lagos = (local: string) => new Date(`${local}+01:00`).toISOString()
  const readyAt = lagos("2026-10-09T10:00:00")
  const DRY = [{ perishable: false }]
  const FRESH = [{ perishable: true }]
  const closedOn = (date: string) => ({ starts_on: date, ends_on: date, closed: true, periods: [], note: null })

  test("a non-perishable order is held until closing on the 5th open day after Ready, the Ready day and Sunday not counting", () => {
    // Saturday, Monday, Tuesday, Wednesday, then Thursday.
    expect(collectBy(readyAt, HOURS, DRY)).toBe(lagos("2026-10-15T18:00:00"))
  })

  test("a perishable order is held until closing on the next open day after Ready", () => {
    expect(collectBy(readyAt, HOURS, FRESH)).toBe(lagos("2026-10-10T14:00:00"))
  })

  test("a mixed order is held as long as its fresh items, the shorter of the two", () => {
    expect(collectBy(readyAt, HOURS, [{ perishable: false }, { perishable: true }])).toBe(lagos("2026-10-10T14:00:00"))
  })

  test("an order ready after closing still doesn't count its Ready day", () => {
    expect(collectBy(lagos("2026-10-10T20:00:00"), HOURS, FRESH)).toBe(lagos("2026-10-12T18:00:00"))
  })

  test("a day closed by an exception doesn't count, and a day of special hours ends when they do", () => {
    const hours = { ...HOURS, exceptions: [closedOn("2026-10-13")] }
    expect(collectBy(readyAt, hours, DRY)).toBe(lagos("2026-10-16T18:00:00"))
    const sundayOpening = { ...HOURS, exceptions: [{ ...closedOn("2026-10-11"), closed: false, periods: [{ opens: "10:00", closes: "12:00" }] }] }
    expect(collectBy(lagos("2026-10-10T09:30:00"), sundayOpening, FRESH)).toBe(lagos("2026-10-11T12:00:00"))
  })

  test("a day the shop is paused all day doesn't count; one paused for part of it does", () => {
    const allMonday = { ...HOURS, pauses: [{ starts_at: lagos("2026-10-12T08:00:00"), ends_at: lagos("2026-10-13T08:00:00") }] }
    expect(collectBy(readyAt, allMonday, DRY)).toBe(lagos("2026-10-16T18:00:00"))
    const mondayMorning = { ...HOURS, pauses: [{ starts_at: lagos("2026-10-12T08:00:00"), ends_at: lagos("2026-10-12T11:00:00") }] }
    expect(collectBy(readyAt, mondayMorning, DRY)).toBe(lagos("2026-10-15T18:00:00"))
  })

  test("is frozen while the shop is paused with no resume date before the hold ends", () => {
    const paused = { ...HOURS, pauses: [{ starts_at: lagos("2026-10-12T08:00:00"), ends_at: null }] }
    expect(collectBy(readyAt, paused, DRY)).toBeNull()
    // A perishable hold already ended on the Saturday.
    expect(collectBy(readyAt, paused, FRESH)).toBe(lagos("2026-10-10T14:00:00"))
    const lastAfternoon = { ...HOURS, pauses: [{ starts_at: lagos("2026-10-15T15:00:00"), ends_at: null }] }
    expect(collectBy(readyAt, lastAfternoon, DRY)).toBeNull()
  })
})

describe("collectByLabel", () => {
  test("names the closing time and day in the shop's timezone", () => {
    expect(collectByLabel("2026-10-15T17:00:00.000Z", "Africa/Lagos")).toBe("Collect by 6pm Thu 15 Oct")
    expect(collectByLabel("2026-10-10T12:30:00.000Z", "Africa/Lagos")).toBe("Collect by 1:30pm Sat 10 Oct")
  })

  test("calls a midnight closing the end of the day before, not the start of the next", () => {
    expect(collectByLabel("2026-10-15T23:00:00.000Z", "Africa/Lagos")).toBe("Collect by midnight Thu 15 Oct")
  })
})
