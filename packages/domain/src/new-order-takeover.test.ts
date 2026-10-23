import { describe, expect, test } from "bun:test"
import { acceptWithinLabel, takeoverAnnouncement } from "./new-order-takeover"

const order = { displayId: 1044, method: "delivery", itemCount: 3, total: "₦32,500.00" }

describe("takeoverAnnouncement", () => {
  test("says the order and the time left to accept it", () => {
    const acceptBy = "2026-10-04T19:30:00.000Z"
    expect(takeoverAnnouncement({ ...order, acceptBy }, new Date("2026-10-04T17:42:00.000Z"), null)).toBe(
      "New order #1044, delivery, 3 items, ₦32,500.00. 1h 48m left to accept."
    )
  })

  test("without a deadline, just the order", () => {
    expect(takeoverAnnouncement({ ...order, itemCount: 1, acceptBy: null }, new Date(), null)).toBe("New order #1044, delivery, 1 item, ₦32,500.00.")
  })
})

describe("acceptWithinLabel", () => {
  test("the time left to accept", () => {
    expect(acceptWithinLabel("2026-10-04T19:30:00.000Z", new Date("2026-10-04T17:42:00.000Z"), null)).toBe("Accept within 1h 48m")
  })

  test("past the deadline", () => {
    expect(acceptWithinLabel("2026-10-04T17:00:00.000Z", new Date("2026-10-04T17:42:00.000Z"), null)).toBe("Overdue to accept")
  })
})
