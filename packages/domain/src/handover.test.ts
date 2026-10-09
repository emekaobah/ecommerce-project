import { describe, expect, test } from "bun:test"
import type { Fulfilment } from "./fulfilment"
import { handoverDisagreement } from "./handover"

const actor = "mem_staff_1"
const at = "2026-10-09T10:00:00.000Z"
const hoursLater = (hours: number) => new Date(new Date(at).getTime() + hours * 60 * 60 * 1000)

describe("handoverDisagreement", () => {
  const tapped: Fulfilment = { state: "courier_confirmed", handover: { staff: { actor, at } } }
  const pickedUp: Fulfilment = { state: "courier_confirmed", handover: { pickup: { at } } }

  test("staff handed over two hours ago and the courier hasn't reported the pickup: waiting for the courier", () => {
    expect(handoverDisagreement(tapped, hoursLater(2))).toEqual({ waiting_for: "courier", since: at })
  })

  test("the courier reported the pickup two hours ago and no one tapped: waiting for staff", () => {
    expect(handoverDisagreement(pickedUp, hoursLater(2))).toEqual({ waiting_for: "staff", since: at })
  })

  test("isn't one yet within two hours", () => {
    expect(handoverDisagreement(tapped, hoursLater(1.99))).toBeNull()
  })

  test("isn't one before either half, or once both are in", () => {
    expect(handoverDisagreement({ state: "courier_confirmed", handover: {} }, hoursLater(10))).toBeNull()
    const handedOver: Fulfilment = { state: "handed_to_courier", handover: { staff: { actor, at }, pickup: { at } } }
    expect(handoverDisagreement(handedOver, hoursLater(10))).toBeNull()
  })
})
