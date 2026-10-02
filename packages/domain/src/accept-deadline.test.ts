import { describe, expect, test } from "bun:test"
import { acceptDeadline, acceptTimeLeft } from "./accept-deadline"

describe("acceptDeadline", () => {
  test("is 24 hours after the order was placed", () => {
    expect(acceptDeadline("2026-10-03T19:30:00.000Z")).toBe("2026-10-04T19:30:00.000Z")
  })
})

describe("acceptTimeLeft", () => {
  const deadline = "2026-10-04T19:30:00.000Z"

  test.each([
    ["hours and minutes while more than an hour is left", "2026-10-04T14:18:00.000Z", "5h 12m left"],
    ["whole hours with no minutes", "2026-10-04T17:30:00.000Z", "2h 0m left"],
    ["minutes alone in the last hour", "2026-10-04T19:05:30.000Z", "24m left"],
    ["under a minute as less than a minute", "2026-10-04T19:29:31.000Z", "Less than a minute left"],
    ["overdue once the deadline has passed", "2026-10-04T19:30:00.000Z", "Overdue"],
  ])("shows %s", (_, now, label) => {
    expect(acceptTimeLeft(deadline, new Date(now))).toEqual({ label, urgent: expect.any(Boolean) })
  })

  test("is urgent in the last two hours", () => {
    expect(acceptTimeLeft(deadline, new Date("2026-10-04T17:29:00.000Z")).urgent).toBe(false)
    expect(acceptTimeLeft(deadline, new Date("2026-10-04T17:30:00.000Z")).urgent).toBe(true)
    expect(acceptTimeLeft(deadline, new Date("2026-10-05T00:00:00.000Z")).urgent).toBe(true)
  })
})
