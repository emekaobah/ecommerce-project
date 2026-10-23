import { describe, expect, test } from "bun:test"
import { dateLabel } from "./date-label"

const LAGOS = "Africa/Lagos"
// Friday 23 October 2026, 9:41 in Lagos.
const friday = new Date("2026-10-23T08:41:00Z")

describe("dateLabel", () => {
  test("reads the weekday, day and short month by default", () => {
    expect(dateLabel(friday, LAGOS)).toBe("Fri 23 Oct")
  })

  test("reads the weekday alone", () => {
    expect(dateLabel(friday, LAGOS, { date: false })).toBe("Fri")
  })

  test("reads the day and month without the weekday", () => {
    expect(dateLabel(friday, LAGOS, { weekday: false })).toBe("23 Oct")
  })

  test("adds the year when asked", () => {
    expect(dateLabel(new Date("2025-12-28T10:00:00Z"), LAGOS, { weekday: false, year: true })).toBe("28 Dec 2025")
  })

  test.each([
    ["2026-01-05T10:00:00Z", "Mon 5 Jan"],
    ["2026-02-03T10:00:00Z", "Tue 3 Feb"],
    ["2026-03-04T10:00:00Z", "Wed 4 Mar"],
    ["2026-04-02T10:00:00Z", "Thu 2 Apr"],
    ["2026-05-02T10:00:00Z", "Sat 2 May"],
    ["2026-06-07T10:00:00Z", "Sun 7 Jun"],
    ["2026-07-01T10:00:00Z", "Wed 1 Jul"],
    ["2026-08-31T10:00:00Z", "Mon 31 Aug"],
    // Some ICU builds abbreviate September "Sept"; the app always reads "Sep".
    ["2026-09-20T10:00:00Z", "Sun 20 Sep"],
    ["2026-11-30T10:00:00Z", "Mon 30 Nov"],
    ["2026-12-25T10:00:00Z", "Fri 25 Dec"],
  ])("%s reads %s, whatever the runtime's month names", (at, label) => {
    expect(dateLabel(new Date(at), LAGOS)).toBe(label)
  })

  test("the day is the time zone's, not UTC's", () => {
    // 23:30 UTC on the 22nd is already the 23rd in Lagos.
    expect(dateLabel(new Date("2026-10-22T23:30:00Z"), LAGOS)).toBe("Fri 23 Oct")
    expect(dateLabel(new Date("2026-10-22T23:30:00Z"), "UTC")).toBe("Thu 22 Oct")
  })

  test("takes an instant as milliseconds or ISO 8601 too", () => {
    expect(dateLabel(friday.getTime(), LAGOS)).toBe("Fri 23 Oct")
    expect(dateLabel("2026-10-23T08:41:00Z", LAGOS)).toBe("Fri 23 Oct")
  })
})
