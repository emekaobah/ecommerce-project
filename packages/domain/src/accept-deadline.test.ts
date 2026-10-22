import { describe, expect, test } from "bun:test"
import { acceptClockFraction, acceptDeadline, acceptReminderDue, acceptTimeLeft } from "./accept-deadline"
import type { ShopHours } from "./shop-hours"

// Weekdays 08:00–18:00, Saturday 09:00–14:00, closed Sunday, in Lagos (UTC+1). Friday 9 October 2026.
const weekdays = [{ opens: "08:00", closes: "18:00" }]
const HOURS: ShopHours = {
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
const lagos = (local: string) => new Date(`${local}+01:00`).toISOString()

describe("acceptDeadline", () => {
  test("is 24 open hours after the order was placed (ADR 0004)", () => {
    // Placed Friday 20:00: Saturday 5 hours, Monday 10, then nine hours into Tuesday.
    expect(acceptDeadline(lagos("2026-10-09T20:00:00"), HOURS)).toBe(lagos("2026-10-13T17:00:00"))
  })

  test("keeps its time when the shop pauses after the order was placed, resumed or not (#18)", () => {
    // Paused all Monday, or from Monday on: the order still has Saturday 5, Monday 10, nine hours into Tuesday.
    const resumed = { ...HOURS, pauses: [{ starts_at: lagos("2026-10-12T08:00:00"), ends_at: lagos("2026-10-13T08:00:00") }] }
    expect(acceptDeadline(lagos("2026-10-09T20:00:00"), resumed)).toBe(lagos("2026-10-13T17:00:00"))
    const paused = { ...HOURS, pauses: [{ starts_at: lagos("2026-10-12T08:00:00"), ends_at: null }] }
    expect(acceptDeadline(lagos("2026-10-09T20:00:00"), paused)).toBe(lagos("2026-10-13T17:00:00"))
  })

  test("doesn't count a pause over before the order was placed", () => {
    const earlier = { ...HOURS, pauses: [{ starts_at: lagos("2026-10-05T08:00:00"), ends_at: lagos("2026-10-06T08:00:00") }] }
    expect(acceptDeadline(lagos("2026-10-09T20:00:00"), earlier)).toBe(lagos("2026-10-13T17:00:00"))
  })

  test("still stops over closed hours and closure exceptions", () => {
    const closedMonday = {
      ...HOURS,
      exceptions: [{ starts_on: "2026-10-12", ends_on: "2026-10-12", closed: true, periods: [], note: null }],
      pauses: [{ starts_at: lagos("2026-10-12T08:00:00"), ends_at: null }],
    }
    // Closed Sunday and the Monday exception: Saturday 5, Tuesday 10, nine hours into Wednesday.
    expect(acceptDeadline(lagos("2026-10-09T20:00:00"), closedMonday)).toBe(lagos("2026-10-14T17:00:00"))
  })

  test("is 24 hours on for a shop without hours", () => {
    expect(acceptDeadline("2026-10-03T19:30:00.000Z", null)).toBe("2026-10-04T19:30:00.000Z")
  })
})

describe("acceptTimeLeft", () => {
  const deadline = "2026-10-04T19:30:00.000Z"

  test.each([
    ["hours and minutes while more than an hour is left", "2026-10-04T14:18:00.000Z", "5h 12m left"],
    ["whole hours without minutes", "2026-10-04T17:30:00.000Z", "2h left"],
    ["minutes alone in the last hour", "2026-10-04T19:05:30.000Z", "24m left"],
    ["under a minute as less than a minute", "2026-10-04T19:29:31.000Z", "Less than a minute left"],
    ["overdue once the deadline has passed", "2026-10-04T19:30:00.000Z", "Overdue"],
  ])("shows %s", (_, now, label) => {
    expect(acceptTimeLeft(deadline, new Date(now)).label).toBe(label)
  })

  test("is urgent in the last two hours", () => {
    expect(acceptTimeLeft(deadline, new Date("2026-10-04T17:29:00.000Z")).urgent).toBe(false)
    expect(acceptTimeLeft(deadline, new Date("2026-10-04T17:30:00.000Z")).urgent).toBe(true)
    expect(acceptTimeLeft(deadline, new Date("2026-10-05T00:00:00.000Z")).urgent).toBe(true)
  })

  test("says what it counts down to, for VoiceOver", () => {
    expect(acceptTimeLeft(deadline, new Date("2026-10-04T17:42:00.000Z")).accessibilityLabel).toBe("1h 48m left to accept")
    expect(acceptTimeLeft(deadline, new Date("2026-10-04T19:30:00.000Z")).accessibilityLabel).toBe("Overdue to accept")
  })

  describe("with the shop's hours", () => {
    // Placed Friday 20:00: deadline Tuesday 17:00.
    const placed = lagos("2026-10-09T20:00:00")
    const open = lagos("2026-10-13T17:00:00")

    test("counts open time left, not the night", () => {
      // Monday 08:00: Monday 10 and Tuesday 9 open hours are left, though 33 hours of clock are.
      expect(acceptTimeLeft(open, new Date(lagos("2026-10-12T08:00:00")), HOURS)).toEqual({
        label: "19h left",
        accessibilityLabel: "19h of open time left to accept",
        urgent: false,
      })
      // Overnight Monday, still nine.
      expect(acceptTimeLeft(open, new Date(lagos("2026-10-12T23:00:00")), HOURS).label).toBe("9h left")
    })

    test("turns urgent exactly when the reminder push goes", () => {
      for (const now of ["2026-10-13T14:00:00", "2026-10-13T15:00:00", "2026-10-13T16:59:00"]) {
        const at = new Date(lagos(now))
        expect(acceptTimeLeft(open, at, HOURS).urgent).toBe(acceptReminderDue(placed, at, HOURS))
      }
    })

    test("is urgent overnight with under two open hours left, as the push is", () => {
      // Placed Saturday 11:00: deadline Wednesday 09:00, one open hour left all Tuesday night.
      const deadline = lagos("2026-10-14T09:00:00")
      const night = new Date(lagos("2026-10-13T23:00:00"))
      expect(acceptTimeLeft(deadline, night, HOURS)).toEqual({ label: "1h left", accessibilityLabel: "1h of open time left to accept", urgent: true })
      expect(acceptReminderDue(lagos("2026-10-10T11:00:00"), night, HOURS)).toBe(true)
    })
  })
})

describe("acceptReminderDue", () => {
  const placedAt = "2026-10-03T19:30:00.000Z"

  test("counts the last two open hours", () => {
    // Deadline Tuesday 17:00: three open hours are left at Tuesday 14:00, two at 15:00.
    const placed = lagos("2026-10-09T20:00:00")
    expect(acceptReminderDue(placed, new Date(lagos("2026-10-13T14:00:00")), HOURS)).toBe(false)
    expect(acceptReminderDue(placed, new Date(lagos("2026-10-13T15:00:00")), HOURS)).toBe(true)
    expect(acceptReminderDue(placed, new Date(lagos("2026-10-13T17:00:00")), HOURS)).toBe(false)
  })

  test("counts open hours, not the night, towards the last two", () => {
    // Placed Saturday 11:00 (3 + 10 + 10 + 1 hours): deadline Wednesday 09:00, so Tuesday 23:00 has one open hour left.
    const placed = lagos("2026-10-10T11:00:00")
    expect(acceptDeadline(placed, HOURS)).toBe(lagos("2026-10-14T09:00:00"))
    expect(acceptReminderDue(placed, new Date(lagos("2026-10-13T23:00:00")), HOURS)).toBe(true)
    expect(acceptReminderDue(placed, new Date(lagos("2026-10-13T12:00:00")), HOURS)).toBe(false)
  })

  test("still comes when the shop pauses for good after the order was placed (#18)", () => {
    const paused = { ...HOURS, pauses: [{ starts_at: lagos("2026-10-12T08:00:00"), ends_at: null }] }
    // Deadline Tuesday 17:00 as if open: two hours are left at Tuesday 15:00, paused or not.
    expect(acceptReminderDue(lagos("2026-10-09T20:00:00"), new Date(lagos("2026-10-13T15:00:00")), paused)).toBe(true)
    expect(acceptReminderDue(lagos("2026-10-09T20:00:00"), new Date(lagos("2026-10-13T14:00:00")), paused)).toBe(false)
  })

  test.each([
    ["not before the countdown turns urgent", "2026-10-04T17:29:59.000Z", false],
    ["once two hours are left", "2026-10-04T17:30:00.000Z", true],
    ["while the order still waits", "2026-10-04T19:29:00.000Z", true],
    ["not once the deadline has passed: the order is rejected instead", "2026-10-04T19:30:00.000Z", false],
  ])("is %s", (_, now, due) => {
    expect(acceptReminderDue(placedAt, new Date(now), null)).toBe(due)
  })
})

describe("acceptClockFraction", () => {
  // Placed Friday 20:00: deadline Tuesday 17:00 after Saturday 5, Monday 10 and Tuesday 9 open hours.
  const deadline = lagos("2026-10-13T17:00:00")

  test("is the share of the 24 open hours still left", () => {
    // Saturday 09:00: all 24 open hours are left. Monday 08:00: Saturday's 5 are gone, 19 left.
    expect(acceptClockFraction(deadline, new Date(lagos("2026-10-10T09:00:00")), HOURS)).toBe(1)
    expect(acceptClockFraction(deadline, new Date(lagos("2026-10-12T08:00:00")), HOURS)).toBeCloseTo(19 / 24)
  })

  test("holds still while the shop is closed", () => {
    // Saturday 14:00 to Monday 08:00 is closed: 19 open hours are left all that time.
    expect(acceptClockFraction(deadline, new Date(lagos("2026-10-10T14:00:00")), HOURS)).toBeCloseTo(19 / 24)
    expect(acceptClockFraction(deadline, new Date(lagos("2026-10-11T12:00:00")), HOURS)).toBeCloseTo(19 / 24)
  })

  test("keeps draining through a pause: a pause doesn't stop the clock (#18)", () => {
    const paused = { ...HOURS, pauses: [{ starts_at: lagos("2026-10-12T08:00:00"), ends_at: null }] }
    // Tuesday 15:00: two open hours are left, paused or not.
    expect(acceptClockFraction(deadline, new Date(lagos("2026-10-13T15:00:00")), paused)).toBeCloseTo(2 / 24)
  })

  test("is empty once the deadline has passed", () => {
    expect(acceptClockFraction(deadline, new Date(lagos("2026-10-13T17:00:00")), HOURS)).toBe(0)
    expect(acceptClockFraction(deadline, new Date(lagos("2026-10-14T09:00:00")), HOURS)).toBe(0)
  })

  test("counts the wall clock for a shop without hours", () => {
    // 1h 48m of 24h left: the catalogue draws it as 8 of 100.
    const now = new Date("2026-10-22T10:00:00.000Z")
    expect(acceptClockFraction("2026-10-22T11:48:00.000Z", now, null)).toBeCloseTo(1.8 / 24)
    expect(acceptClockFraction("2026-10-23T07:00:00.000Z", now, null)).toBeCloseTo(21 / 24)
  })
})
