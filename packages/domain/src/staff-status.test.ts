import { describe, expect, test } from "bun:test"
import { acceptClockStatus, staffStatus } from "./staff-status"

describe("staffStatus", () => {
  test.each([
    ["new", "New", "new", "clock"],
    ["accepted", "Accepted", "info", "box"],
    ["picking", "Picking", "info", "box"],
    ["partially_available", "Picking", "info", "box"],
    ["packed", "Packed", "info", "box"],
    ["label_booked", "Label booked", "info", "truck"],
    ["courier_confirmed", "Courier confirmed", "info", "truck"],
    ["handed_to_courier", "Handed to courier", "info", "truck"],
    ["in_transit", "In transit", "info", "truck"],
    ["delivered", "Delivered", "success", "check"],
    ["ready_for_pickup", "Ready for pickup", "success", "store"],
    ["collected", "Collected", "success", "check"],
    ["rejected", "Rejected", "neutral", "x"],
    ["cancelled", "Cancelled", "neutral", "x"],
    ["not_collected", "Not collected", "neutral", "x"],
  ] as const)("a %s order reads %s to staff", (state, label, tone, icon) => {
    expect(staffStatus(state)).toEqual({ label, tone, icon })
  })
})

describe("acceptClockStatus", () => {
  const now = new Date("2026-10-22T10:00:00.000Z")

  test("a new order with time to spare waits on the shop, in sun", () => {
    expect(acceptClockStatus("2026-10-23T07:00:00.000Z", now)).toEqual({ label: "21h 0m left", tone: "new", icon: "clock" })
  })

  test("turns ember in the last two hours to accept", () => {
    expect(acceptClockStatus("2026-10-22T11:48:00.000Z", now)).toEqual({ label: "1h 48m left", tone: "attention", icon: "clock" })
  })

  test("stays ember once overdue", () => {
    expect(acceptClockStatus("2026-10-22T09:00:00.000Z", now)).toEqual({ label: "Overdue", tone: "attention", icon: "clock" })
  })
})
