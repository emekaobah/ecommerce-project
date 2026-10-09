import { describe, expect, test } from "bun:test"
import type { Fulfilment } from "./fulfilment"
import { fulfilmentTimeline, recordReached } from "./timeline"

const actor = "mem_staff_1"
const handover = { staff: { actor, at: "2026-10-09T11:00:00.000Z" }, pickup: { at: "2026-10-09T11:05:00.000Z" } }

describe("recordReached", () => {
  test("records when the order reached its new state", () => {
    expect(recordReached({ accepted: "t1" }, { state: "accepted" }, { state: "picking" }, "t2")).toEqual({
      accepted: "t1",
      picking: "t2",
    })
  })

  test("leaves the record as it was when the state didn't change (half a handover)", () => {
    const confirmed: Fulfilment = { state: "courier_confirmed", handover: {} }
    const halfway: Fulfilment = { state: "courier_confirmed", handover: { staff: handover.staff } }
    expect(recordReached({ courier_confirmed: "t1" }, confirmed, halfway, "t2")).toEqual({ courier_confirmed: "t1" })
  })

  test("a state reached again takes its new time (a rebooked label)", () => {
    expect(recordReached({ label_booked: "t1", packed: "t0" }, { state: "packed" }, { state: "label_booked" }, "t3")).toEqual({
      label_booked: "t3",
      packed: "t0",
    })
  })

  test("a handover is reached when the courier picked the parcel up, whichever half came last", () => {
    const tapped: Fulfilment = { state: "courier_confirmed", handover: { staff: handover.staff } }
    const handedOver: Fulfilment = { state: "handed_to_courier", handover }
    expect(recordReached({}, tapped, handedOver, handover.pickup.at)).toEqual({ handed_to_courier: handover.pickup.at })
    const pickedUp: Fulfilment = { state: "courier_confirmed", handover: { pickup: handover.pickup } }
    expect(recordReached({}, pickedUp, handedOver, "2026-10-09T16:00:00.000Z")).toEqual({ handed_to_courier: handover.pickup.at })
  })

  test("a handover completed after the courier moved on records each state the courier reported, when it reported it", () => {
    const waiting: Fulfilment = {
      state: "courier_confirmed",
      handover: {
        pickup: handover.pickup,
        reported: [
          { state: "in_transit", at: "2026-10-09T12:00:00.000Z" },
          { state: "delivered", at: "2026-10-09T14:00:00.000Z" },
        ],
      },
    }
    const tappedAt = "2026-10-09T15:00:00.000Z"
    const delivered: Fulfilment = { state: "delivered", handover: { staff: { actor, at: tappedAt }, pickup: handover.pickup } }
    expect(recordReached({ courier_confirmed: "t1" }, waiting, delivered, tappedAt)).toEqual({
      courier_confirmed: "t1",
      handed_to_courier: handover.pickup.at,
      in_transit: "2026-10-09T12:00:00.000Z",
      delivered: "2026-10-09T14:00:00.000Z",
    })
  })

  test("transit completing a handover staff had tapped records the handover and the transit at once", () => {
    const tapped: Fulfilment = { state: "courier_confirmed", handover: { staff: handover.staff } }
    const inTransit: Fulfilment = { state: "in_transit", handover: { staff: handover.staff, pickup: { at: "t5" } } }
    expect(recordReached({}, tapped, inTransit, "t5")).toEqual({ handed_to_courier: "t5", in_transit: "t5" })
  })
})

describe("fulfilmentTimeline", () => {
  const placedAt = "2026-10-09T08:00:00.000Z"

  test("shows the buyer each step, done up to where the order is, with when it got there", () => {
    const timeline = fulfilmentTimeline(
      {
        state: "handed_to_courier",
        placed_at: placedAt,
        reached: {
          accepted: "2026-10-09T08:10:00.000Z",
          picking: "2026-10-09T08:20:00.000Z",
          packed: "2026-10-09T09:00:00.000Z",
          label_booked: "2026-10-09T09:05:00.000Z",
          courier_confirmed: "2026-10-09T09:30:00.000Z",
          handed_to_courier: "2026-10-09T11:05:00.000Z",
        },
      },
      "buyer",
    )
    expect(timeline).toEqual([
      { label: "Order placed", status: "done", at: placedAt },
      { label: "Accepted", status: "done", at: "2026-10-09T08:10:00.000Z" },
      { label: "Being prepared", status: "done", at: "2026-10-09T08:20:00.000Z" },
      { label: "Packed", status: "done", at: "2026-10-09T09:00:00.000Z" },
      { label: "Courier booked", status: "done", at: "2026-10-09T09:05:00.000Z" },
      { label: "Picked up by the courier", status: "current", at: "2026-10-09T11:05:00.000Z" },
      { label: "On its way", status: "upcoming", at: null },
      { label: "Delivered", status: "upcoming", at: null },
    ])
  })

  test("shows staff the finer steps", () => {
    expect(fulfilmentTimeline({ state: "courier_confirmed", placed_at: placedAt, reached: {} }, "staff").map((s) => s.label)).toEqual([
      "Placed",
      "Accepted",
      "Picking",
      "Packed",
      "Label booked",
      "Courier confirmed",
      "Handed to courier",
      "In transit",
      "Delivered",
    ])
  })

  test("a partially available order is still being picked", () => {
    const timeline = fulfilmentTimeline({ state: "partially_available", placed_at: placedAt, reached: {} }, "staff")
    expect(timeline.find((s) => s.status === "current")?.label).toBe("Picking")
  })

  test("doesn't show the time of a step the order went back from (a cancelled label)", () => {
    const timeline = fulfilmentTimeline(
      { state: "packed", placed_at: placedAt, reached: { packed: "t1", label_booked: "t2", courier_confirmed: "t3" } },
      "staff",
    )
    expect(timeline.find((s) => s.label === "Label booked")).toEqual({ label: "Label booked", status: "upcoming", at: null })
  })

  test("a delivered order has every step done, a skipped one without a time", () => {
    const timeline = fulfilmentTimeline(
      { state: "delivered", placed_at: placedAt, reached: { handed_to_courier: "t1", delivered: "t2" } },
      "buyer",
    )
    expect(timeline.every((s) => s.status === "done")).toBe(true)
    expect(timeline.slice(-2)).toEqual([
      { label: "On its way", status: "done", at: null },
      { label: "Delivered", status: "done", at: "t2" },
    ])
  })

  test("a rejected order has no timeline: its status says why", () => {
    expect(fulfilmentTimeline({ state: "rejected", placed_at: placedAt, reached: {} }, "buyer")).toEqual([])
  })
})
