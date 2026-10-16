import { describe, expect, test } from "bun:test"
import { collectBy } from "./pickup-hold"
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

const RICE = { perishable: false }
const TOMATOES = { perishable: true }
const READY_FRIDAY = lagos("2026-10-09T15:00:00")

describe("collectBy", () => {
  test("a non-perishable order is held until closing on the 5th open day after Ready", () => {
    // Saturday, (Sunday closed), Monday, Tuesday, Wednesday, Thursday.
    expect(collectBy(HOURS, READY_FRIDAY, [RICE])).toBe(lagos("2026-10-15T18:00:00"))
  })

  test("a perishable order is held until closing on the next open day after Ready", () => {
    expect(collectBy(HOURS, READY_FRIDAY, [TOMATOES])).toBe(lagos("2026-10-10T14:00:00"))
    // Ready on Saturday: Sunday is closed, so Monday.
    expect(collectBy(HOURS, lagos("2026-10-10T12:00:00"), [TOMATOES])).toBe(lagos("2026-10-12T18:00:00"))
  })

  test("a mixed order takes the shorter hold, the perishable one", () => {
    expect(collectBy(HOURS, READY_FRIDAY, [RICE, TOMATOES])).toBe(lagos("2026-10-10T14:00:00"))
  })

  test("the Ready day doesn't count, even when the shop opens after the order was ready", () => {
    expect(collectBy(HOURS, lagos("2026-10-09T07:00:00"), [TOMATOES])).toBe(lagos("2026-10-10T14:00:00"))
  })

  test("a day closed by an exception isn't an open day", () => {
    const closedMonday = {
      ...HOURS,
      exceptions: [{ starts_on: "2026-10-12", ends_on: "2026-10-12", closed: true, periods: [], note: "Holiday" }],
    }
    // Saturday, Tuesday, Wednesday, Thursday, Friday.
    expect(collectBy(closedMonday, READY_FRIDAY, [RICE])).toBe(lagos("2026-10-16T18:00:00"))
  })

  test("a normally closed day opened by an exception is an open day, closing at its special hours", () => {
    const openSunday = {
      ...HOURS,
      exceptions: [
        { starts_on: "2026-10-11", ends_on: "2026-10-11", closed: false, periods: [{ opens: "10:00", closes: "13:00" }], note: null },
      ],
    }
    expect(collectBy(openSunday, lagos("2026-10-10T12:00:00"), [TOMATOES])).toBe(lagos("2026-10-11T13:00:00"))
    // Saturday, Sunday, Monday, Tuesday, Wednesday.
    expect(collectBy(openSunday, READY_FRIDAY, [RICE])).toBe(lagos("2026-10-14T18:00:00"))
  })

  test("a day the shop is paused through isn't an open day", () => {
    const pausedMonday = { ...HOURS, pauses: [{ starts_at: lagos("2026-10-12T00:00:00"), ends_at: lagos("2026-10-13T00:00:00") }] }
    expect(collectBy(pausedMonday, READY_FRIDAY, [RICE])).toBe(lagos("2026-10-16T18:00:00"))
    expect(collectBy(pausedMonday, lagos("2026-10-10T12:00:00"), [TOMATOES])).toBe(lagos("2026-10-13T18:00:00"))
  })

  test("a day the shop opens for part of, around a pause, is still an open day", () => {
    const pausedMorning = { ...HOURS, pauses: [{ starts_at: lagos("2026-10-12T00:00:00"), ends_at: lagos("2026-10-12T12:00:00") }] }
    expect(collectBy(pausedMorning, lagos("2026-10-10T12:00:00"), [TOMATOES])).toBe(lagos("2026-10-12T18:00:00"))
  })

  test("is frozen while the shop is paused with no resume date", () => {
    const paused = { ...HOURS, pauses: [{ starts_at: lagos("2026-10-12T08:00:00"), ends_at: null }] }
    expect(collectBy(paused, READY_FRIDAY, [RICE])).toBeNull()
    // Resumed on Wednesday: Monday and Tuesday don't count, so Saturday, Wednesday, Thursday, Friday, Saturday.
    const resumed = { ...HOURS, pauses: [{ starts_at: lagos("2026-10-12T08:00:00"), ends_at: lagos("2026-10-14T08:00:00") }] }
    expect(collectBy(resumed, READY_FRIDAY, [RICE])).toBe(lagos("2026-10-17T14:00:00"))
  })

  test("a hold that ended before an unresumed pause began still ended", () => {
    const paused = { ...HOURS, pauses: [{ starts_at: lagos("2026-10-12T08:00:00"), ends_at: null }] }
    expect(collectBy(paused, READY_FRIDAY, [TOMATOES])).toBe(lagos("2026-10-10T14:00:00"))
  })
})
