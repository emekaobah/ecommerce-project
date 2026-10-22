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
    expect(acceptClockStatus("2026-10-23T07:00:00.000Z", now)).toEqual({ label: "21h left", tone: "new", icon: "clock" })
  })

  test("turns ember in the last two hours to accept", () => {
    expect(acceptClockStatus("2026-10-22T11:48:00.000Z", now)).toEqual({ label: "1h 48m left", tone: "attention", icon: "clock" })
  })

  test("counts the shop's open time, ember in its last two open hours", () => {
    // Open 08:00–18:00 every day in Lagos: at 17:00 one open hour is left today and one tomorrow.
    const day = [{ opens: "08:00", closes: "18:00" }]
    const hours = {
      time_zone: "Africa/Lagos",
      weekly: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day },
      exceptions: [],
      pauses: [],
    }
    const at = new Date("2026-10-22T16:00:00.000Z")
    expect(acceptClockStatus("2026-10-23T08:00:00.000Z", at, hours)).toEqual({ label: "2h left", tone: "attention", icon: "clock" })
    expect(acceptClockStatus("2026-10-23T08:00:00.000Z", at)).toEqual({ label: "16h left", tone: "new", icon: "clock" })
  })

  test("stays ember once overdue", () => {
    expect(acceptClockStatus("2026-10-22T09:00:00.000Z", now)).toEqual({ label: "Overdue", tone: "attention", icon: "clock" })
  })
})
