import { describe, expect, test } from "bun:test"
import { arrivesByEndOfNextDay, isPerishable } from "./perishable"

describe("arrivesByEndOfNextDay", () => {
  const lagos = "Africa/Lagos"
  // Monday 5 Oct 2026, 10:00 in Lagos.
  const now = new Date("2026-10-05T10:00:00+01:00")

  test.each([
    ["later today", "2026-10-05T18:00:00+01:00", true],
    ["tomorrow morning", "2026-10-06T09:00:00+01:00", true],
    ["the last second of tomorrow", "2026-10-06T23:59:59+01:00", true],
    ["midnight the day after tomorrow", "2026-10-07T00:00:00+01:00", false],
    ["in three days", "2026-10-08T12:00:00+01:00", false],
  ])("a parcel arriving %s: %p", (_, eta, qualifies) => {
    expect(arrivesByEndOfNextDay(eta, now, lagos)).toBe(qualifies)
  })

  test("counts tomorrow from the region's calendar day, not UTC's", () => {
    // 23:30 Monday in Lagos is 22:30 UTC Monday; tomorrow is still Tuesday in Lagos.
    const lateMonday = new Date("2026-10-05T23:30:00+01:00")
    expect(arrivesByEndOfNextDay("2026-10-06T23:00:00+01:00", lateMonday, lagos)).toBe(true)
    expect(arrivesByEndOfNextDay("2026-10-07T08:00:00+01:00", lateMonday, lagos)).toBe(false)
  })

  test("just after midnight in the region, tomorrow is the region's next day although UTC is still the day before", () => {
    // 00:30 Tuesday in Lagos is 23:30 UTC Monday: tomorrow is Wednesday.
    const earlyTuesday = new Date("2026-10-06T00:30:00+01:00")
    expect(arrivesByEndOfNextDay("2026-10-07T20:00:00+01:00", earlyTuesday, lagos)).toBe(true)
  })

  test("reads an ETA written with another offset at its instant", () => {
    // 23:30 UTC on Tuesday is 00:30 Wednesday in Lagos: too late.
    expect(arrivesByEndOfNextDay("2026-10-06T23:30:00Z", now, lagos)).toBe(false)
    expect(arrivesByEndOfNextDay("2026-10-06T22:30:00Z", now, lagos)).toBe(true)
  })

  test("ends tomorrow at the region's own midnight in a timezone with daylight saving", () => {
    // Saturday 24 Oct 2026, 12:00 in London (BST); the clocks go back early on Sunday 25 Oct.
    const london = "Europe/London"
    const saturday = new Date("2026-10-24T12:00:00+01:00")
    expect(arrivesByEndOfNextDay("2026-10-25T23:59:00Z", saturday, london)).toBe(true)
    expect(arrivesByEndOfNextDay("2026-10-26T00:00:00Z", saturday, london)).toBe(false)
  })

  test("doesn't take an ETA it can't read", () => {
    expect(arrivesByEndOfNextDay("soon", now, lagos)).toBe(false)
  })
})

describe("isPerishable", () => {
  test("a product is perishable when any of its categories is", () => {
    expect(isPerishable({ override: null, categories: [false, true] })).toBe(true)
    expect(isPerishable({ override: null, categories: [false] })).toBe(false)
    expect(isPerishable({ override: null, categories: [] })).toBe(false)
  })

  test("the operator's override wins over its categories, either way", () => {
    expect(isPerishable({ override: false, categories: [true] })).toBe(false)
    expect(isPerishable({ override: true, categories: [] })).toBe(true)
  })
})
