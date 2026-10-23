import { describe, expect, test } from "bun:test"
import { handoverSteps } from "./handover-steps"
import type { TimelineStep } from "./timeline"

const shipment = { courier_name: "GIG Logistics" }

/** The staff timeline of a delivery order at `state`, as the API answers it. */
function timeline(state: "label_booked" | "courier_confirmed"): TimelineStep[] {
  const confirmed = state === "courier_confirmed"
  return [
    { label: "Placed", status: "done", at: "2026-10-23T10:00:00Z" },
    { label: "Accepted", status: "done", at: "2026-10-23T10:05:00Z" },
    { label: "Picking", status: "done", at: "2026-10-23T10:05:00Z" },
    { label: "Packed", status: "done", at: "2026-10-23T11:50:00Z" },
    { label: "Label booked", status: confirmed ? "done" : "current", at: "2026-10-23T12:12:00Z" },
    { label: "Courier confirmed", status: confirmed ? "current" : "upcoming", at: confirmed ? "2026-10-23T12:40:00Z" : null },
    { label: "Handed to courier", status: "upcoming", at: null },
    { label: "In transit", status: "upcoming", at: null },
    { label: "Delivered", status: "upcoming", at: null },
  ]
}

describe("handoverSteps", () => {
  test("courier confirmed: the staff tap is what's next, the courier's pickup after it", () => {
    expect(
      handoverSteps({ shipment, handover: { staff: null, picked_up_at: null }, timeline: timeline("courier_confirmed") })
    ).toEqual([
      { label: "Label booked", status: "done", at: "2026-10-23T12:12:00Z", detail: "GIG Logistics · 1 parcel" },
      { label: "Courier confirmed", status: "done", at: "2026-10-23T12:40:00Z", detail: "GIG Logistics accepted the pickup" },
      { label: "Handed to courier", status: "current", at: null, detail: "Tap when the rider takes the parcel" },
      { label: "Picked up", status: "upcoming", at: null, detail: "GIG Logistics confirms on their side" },
    ])
  })

  test("staff tapped first: their half is done, by them, and the courier's pickup is awaited", () => {
    const steps = handoverSteps({
      shipment,
      handover: { staff: { name: "Bisi", at: "2026-10-23T13:00:00Z" }, picked_up_at: null },
      timeline: timeline("courier_confirmed"),
    })
    expect(steps.slice(2)).toEqual([
      { label: "Handed to courier", status: "done", at: "2026-10-23T13:00:00Z", detail: "By Bisi" },
      { label: "Picked up", status: "current", at: null, detail: "GIG Logistics confirms on their side" },
    ])
  })

  test("the courier picked up first: staff still have to say they handed it over", () => {
    const steps = handoverSteps({
      shipment,
      handover: { staff: null, picked_up_at: "2026-10-23T13:05:00Z" },
      timeline: timeline("courier_confirmed"),
    })
    expect(steps.slice(2)).toEqual([
      { label: "Handed to courier", status: "current", at: null, detail: "Tap when the rider takes the parcel" },
      { label: "Picked up", status: "done", at: "2026-10-23T13:05:00Z", detail: "GIG Logistics confirmed the pickup" },
    ])
  })

  test("a member without a name handed it over", () => {
    const steps = handoverSteps({
      shipment,
      handover: { staff: { name: null, at: "2026-10-23T13:00:00Z" }, picked_up_at: null },
      timeline: timeline("courier_confirmed"),
    })
    expect(steps[2]?.detail).toBe("By a staff member")
  })

  test("label booked: the courier hasn't accepted yet, and neither half can happen", () => {
    expect(handoverSteps({ shipment, handover: null, timeline: timeline("label_booked") })).toEqual([
      { label: "Label booked", status: "done", at: "2026-10-23T12:12:00Z", detail: "GIG Logistics · 1 parcel" },
      { label: "Courier confirmed", status: "current", at: null, detail: "Waiting for GIG Logistics to accept the pickup" },
      { label: "Handed to courier", status: "upcoming", at: null, detail: "Tap when the rider takes the parcel" },
      { label: "Picked up", status: "upcoming", at: null, detail: "GIG Logistics confirms on their side" },
    ])
  })

  test("without a shipment the courier is named generically", () => {
    const steps = handoverSteps({ shipment: null, handover: null, timeline: timeline("label_booked") })
    expect(steps[0]?.detail).toBe("The courier · 1 parcel")
  })
})
