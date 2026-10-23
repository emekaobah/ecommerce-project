import { describe, expect, test } from "bun:test"
import { greeting } from "./greeting"

const LAGOS = "Africa/Lagos"
// Lagos is UTC+1 all year.
const lagos = (time: string) => new Date(`2026-10-23T${time}+01:00`)

describe("greeting", () => {
  test("greets the buyer by first name for the time of day where they are", () => {
    expect(greeting(lagos("09:41:00"), "Tolu", LAGOS)).toBe("Good morning, Tolu.")
    expect(greeting(lagos("13:05:00"), "Tolu", LAGOS)).toBe("Good afternoon, Tolu.")
    expect(greeting(lagos("19:30:00"), "Tolu", LAGOS)).toBe("Good evening, Tolu.")
  })

  test("turns at noon and at 5pm", () => {
    expect(greeting(lagos("11:59:59"), null, LAGOS)).toBe("Good morning.")
    expect(greeting(lagos("12:00:00"), null, LAGOS)).toBe("Good afternoon.")
    expect(greeting(lagos("16:59:59"), null, LAGOS)).toBe("Good afternoon.")
    expect(greeting(lagos("17:00:00"), null, LAGOS)).toBe("Good evening.")
  })

  test("says good evening through the night, and good morning from 5am", () => {
    expect(greeting(lagos("00:30:00"), null, LAGOS)).toBe("Good evening.")
    expect(greeting(lagos("04:59:00"), null, LAGOS)).toBe("Good evening.")
    expect(greeting(lagos("05:00:00"), null, LAGOS)).toBe("Good morning.")
  })

  test("reads the hour in the given time zone, not the device's", () => {
    // 07:41 in Lagos is 15:41 in Tokyo.
    expect(greeting(lagos("07:41:00"), null, "Asia/Tokyo")).toBe("Good afternoon.")
  })

  test("leaves the name out without one, or when it is only spaces", () => {
    expect(greeting(lagos("09:41:00"), null, LAGOS)).toBe("Good morning.")
    expect(greeting(lagos("09:41:00"), "  ", LAGOS)).toBe("Good morning.")
    expect(greeting(lagos("09:41:00"), " Tolu ", LAGOS)).toBe("Good morning, Tolu.")
  })
})
