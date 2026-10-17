import { refundAccountFollowUp } from "../lib/refund-accounts"

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// A refund that needs the buyer's bank account (#13): reminders after 1 and 3 days, and after 7
// days it is handed to Oja's team.
describe("refundAccountFollowUp", () => {
  const since = new Date("2026-10-01T09:00:00Z")
  const at = (ms: number) => refundAccountFollowUp(since, new Date(since.getTime() + ms))

  it("waits during the first day", () => {
    expect(at(0)).toBeNull()
    expect(at(DAY - 1)).toBeNull()
  })

  it("reminds the buyer after a day, and again after 3, with the days left before Oja's team takes it over", () => {
    expect(at(DAY)).toEqual({ reminder: { nth: 1, days_left: 6 } })
    expect(at(3 * DAY - 1)).toEqual({ reminder: { nth: 1, days_left: 6 } })
    expect(at(3 * DAY)).toEqual({ reminder: { nth: 2, days_left: 4 } })
    expect(at(7 * DAY - 1)).toEqual({ reminder: { nth: 2, days_left: 4 } })
  })

  it("hands it to Oja's team after 7 days", () => {
    expect(at(7 * DAY)).toBe("hand_over")
    expect(at(30 * DAY)).toBe("hand_over")
  })
})
