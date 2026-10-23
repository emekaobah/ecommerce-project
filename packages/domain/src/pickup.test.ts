import { describe, expect, test } from "bun:test"
import {
  checkPickupCode,
  isPickupCodeFormat,
  openingHoursLines,
  PICKUP_WRONG_CODE_MESSAGE,
  pickupCodeGroups,
  pickupLockoutMessage,
  todayHoursLabel,
} from "./pickup"

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

describe("pickupCodeGroups", () => {
  test("splits a six-digit code into two groups of three to read at a counter", () => {
    expect(pickupCodeGroups("482913")).toBe("482 913")
  })
})

describe("todayHoursLabel", () => {
  const day = (periods: { opens: string; closes: string }[], closure: { reason: "exception" | "pause"; note: string | null } | null = null) => ({
    date: "2026-10-25",
    periods,
    closure,
  })

  test("says today's hours as the buyer reads times", () => {
    expect(todayHoursLabel(day([{ opens: "10:00", closes: "18:00" }]))).toBe("Open today 10am–6pm")
  })

  test("keeps minutes, noon and a split day", () => {
    expect(todayHoursLabel(day([{ opens: "07:30", closes: "12:00" }, { opens: "13:00", closes: "21:45" }]))).toBe(
      "Open today 7:30am–12pm, 1pm–9:45pm"
    )
  })

  test("a day open around the clock, and one open until midnight", () => {
    expect(todayHoursLabel(day([{ opens: "00:00", closes: "24:00" }]))).toBe("Open 24 hours today")
    expect(todayHoursLabel(day([{ opens: "18:00", closes: "24:00" }]))).toBe("Open today 6pm–midnight")
  })

  test("a day the shop doesn't open is closed today", () => {
    expect(todayHoursLabel(day([]))).toBe("Closed today")
  })

  test("a closure today says so, with the shop's note", () => {
    expect(todayHoursLabel(day([], { reason: "exception", note: "Family event" }))).toBe("Closed today · Family event")
    expect(todayHoursLabel(day([], { reason: "pause", note: null }))).toBe("Closed today")
  })

  test("a pause that cuts the day short leaves what is still open", () => {
    expect(todayHoursLabel(day([{ opens: "10:00", closes: "14:00" }], { reason: "pause", note: "Back tomorrow" }))).toBe(
      "Open today 10am–2pm"
    )
  })

  test("a shop without hours has no line", () => {
    expect(todayHoursLabel(null)).toBeNull()
  })
})

describe("pickupLockoutMessage", () => {
  // Lagos is UTC+1 all year.
  test("says when the counter may try again, in the shop's time", () => {
    expect(pickupLockoutMessage("2026-10-23T14:15:00Z", new Date("2026-10-23T14:02:00Z"), "Africa/Lagos")).toBe(
      "Too many wrong codes. Try again at 3:15pm."
    )
  })

  test("names the day when that is another day", () => {
    expect(pickupLockoutMessage("2026-10-23T23:10:00Z", new Date("2026-10-23T22:58:00Z"), "Africa/Lagos")).toBe(
      "Too many wrong codes. Try again at 12:10am Sat."
    )
  })
})

describe("PICKUP_WRONG_CODE_MESSAGE", () => {
  test("tells staff to check the code with the buyer", () => {
    expect(PICKUP_WRONG_CODE_MESSAGE).toBe("That code doesn't match this order. Check it with the buyer.")
  })
})
