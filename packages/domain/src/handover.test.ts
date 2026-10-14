import { describe, expect, test } from "bun:test"
import type { Fulfilment } from "./fulfilment"
import { handoverAlertDue, handoverDisagreement } from "./handover"

const actor = "mem_staff_1"
const at = "2026-10-09T10:00:00.000Z"
const hoursLater = (hours: number) => new Date(new Date(at).getTime() + hours * 60 * 60 * 1000)

describe("handoverDisagreement", () => {
  const tapped: Fulfilment = { method: "delivery", state: "courier_confirmed", handover: { staff: { actor, at } } }
  const pickedUp: Fulfilment = { method: "delivery", state: "courier_confirmed", handover: { pickup: { at } } }

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
    expect(handoverDisagreement({ method: "delivery", state: "courier_confirmed", handover: {} }, hoursLater(10))).toBeNull()
    const handedOver: Fulfilment = { method: "delivery", state: "handed_to_courier", handover: { staff: { actor, at }, pickup: { at } } }
    expect(handoverDisagreement(handedOver, hoursLater(10))).toBeNull()
  })
})

describe("handoverAlertDue", () => {
  const tapped: Fulfilment = { method: "delivery", state: "courier_confirmed", handover: { staff: { actor, at } } }

  test("is due once the halves disagree and the owner hasn't been alerted", () => {
    expect(handoverAlertDue(tapped, null, hoursLater(2))).toEqual({ waiting_for: "courier", since: at })
  })

  test("is due again a day after the last alert while they still disagree", () => {
    const alertedAt = hoursLater(2).toISOString()
    expect(handoverAlertDue(tapped, alertedAt, hoursLater(25.99))).toBeNull()
    expect(handoverAlertDue(tapped, alertedAt, hoursLater(26))).toEqual({ waiting_for: "courier", since: at })
  })

  test("isn't due once they agree, however long ago the last alert was", () => {
    const handedOver: Fulfilment = { method: "delivery", state: "handed_to_courier", handover: { staff: { actor, at }, pickup: { at } } }
    expect(handoverAlertDue(handedOver, hoursLater(2).toISOString(), hoursLater(100))).toBeNull()
  })
})
