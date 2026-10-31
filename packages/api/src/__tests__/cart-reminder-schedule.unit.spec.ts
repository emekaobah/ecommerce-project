import { cartReminderSchedule } from "../lib/cart-reminders"

// When cart reminders go out, from config (#137): a value that can't work falls back to its default.
describe("cartReminderSchedule", () => {
  const defaults = { delay_hours: 4, send_from_hour: 9, send_until_hour: 20, time_zone: "Africa/Lagos" }

  it("is 4 hours, 9am to 8pm Lagos time, when nothing is set", () => {
    expect(cartReminderSchedule({})).toEqual(defaults)
  })

  it("takes the delay, hours and time zone set", () => {
    expect(
      cartReminderSchedule({
        CART_REMINDER_DELAY_HOURS: "2",
        CART_REMINDER_SEND_FROM_HOUR: "8",
        CART_REMINDER_SEND_UNTIL_HOUR: "22",
        CART_REMINDER_TIME_ZONE: "Europe/London",
      })
    ).toEqual({ delay_hours: 2, send_from_hour: 8, send_until_hour: 22, time_zone: "Europe/London" })
  })

  it("falls back to the default hours when the window would never send: from at or after until", () => {
    for (const [from, until] of [
      ["20", "9"],
      ["12", "12"],
    ]) {
      expect(cartReminderSchedule({ CART_REMINDER_SEND_FROM_HOUR: from, CART_REMINDER_SEND_UNTIL_HOUR: until })).toEqual(defaults)
    }
  })

  it("falls back to the default hours when only one is set and it shuts the window", () => {
    expect(cartReminderSchedule({ CART_REMINDER_SEND_FROM_HOUR: "21" })).toEqual(defaults)
    expect(cartReminderSchedule({ CART_REMINDER_SEND_UNTIL_HOUR: "6" })).toEqual(defaults)
  })

  it("falls back to a default for a value that isn't a number in range", () => {
    expect(
      cartReminderSchedule({ CART_REMINDER_DELAY_HOURS: "soon", CART_REMINDER_SEND_FROM_HOUR: "-1", CART_REMINDER_SEND_UNTIL_HOUR: "25" })
    ).toEqual(defaults)
  })
})
