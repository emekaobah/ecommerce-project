import { describe, expect, test } from "bun:test"
import { checkPickupCode, isPickupCodeFormat, openingHoursLines } from "./pickup"

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
