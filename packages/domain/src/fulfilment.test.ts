import { describe, expect, test } from "bun:test"
import {
  newFulfilment,
  transition,
  type Fulfilment,
  type FulfilmentMethod,
  type FulfilmentState,
  type FulfilmentTrigger,
  type ProviderEventType,
  type DeliveryTrigger,
  type SharedStaffActionType,
  type StaffAction,
  type TransitionResult,
  canCancel,
} from "./fulfilment"

const at = "2026-09-26T10:00:00.000Z"
const actor = "mem_staff_1"

describe("transition", () => {
  const staff = <T extends SharedStaffActionType | "confirm_handover">(type: T): StaffAction<T> => ({ source: "staff", type, actor, at })
  const provider = (type: ProviderEventType): FulfilmentTrigger => ({ source: "provider", type, at })

  test.each<[string, Fulfilment, FulfilmentTrigger, Fulfilment]>([
    ["a new order is accepted by a staff action", newFulfilment("delivery"), staff("accept"), { method: "delivery", state: "accepted" }],
    [
      "a new order is rejected by the seller",
      newFulfilment("delivery"),
      staff("reject"),
      { method: "delivery", state: "rejected", rejectedBy: "seller" },
    ],
    [
      "a new order is rejected when the accept deadline passes",
      newFulfilment("delivery"),
      { source: "system", type: "accept_deadline_passed", at },
      { method: "delivery", state: "rejected", rejectedBy: "accept_deadline" },
    ],
    [
      "staff start picking an accepted order",
      { method: "delivery", state: "accepted" },
      staff("start_picking"),
      { method: "delivery", state: "picking" },
    ],
    ["staff mark a picked order packed", { method: "delivery", state: "picking" }, staff("mark_packed"), { method: "delivery", state: "packed" }],
    [
      "staff flag that items are not all available while picking",
      { method: "delivery", state: "picking" },
      staff("mark_partially_available"),
      { method: "delivery", state: "partially_available" },
    ],
    [
      "staff resume picking once the order has been edited",
      { method: "delivery", state: "partially_available" },
      staff("resume_picking"),
      { method: "delivery", state: "picking" },
    ],
    [
      "staff pack what is available",
      { method: "delivery", state: "partially_available" },
      staff("mark_packed"),
      { method: "delivery", state: "packed" },
    ],
    [
      "the provider creating a label books it for a packed order",
      { method: "delivery", state: "packed" },
      provider("label_created"),
      { method: "delivery", state: "label_booked" },
    ],
    [
      "the provider confirming a courier moves a booked label on, with no handover recorded yet",
      { method: "delivery", state: "label_booked" },
      provider("confirmed"),
      { method: "delivery", state: "courier_confirmed", handover: {} },
    ],
    [
      "a provider cancellation sends a booked label back to packed for rebooking",
      { method: "delivery", state: "label_booked" },
      provider("cancelled"),
      { method: "delivery", state: "packed" },
    ],
  ])("%s", (_name, from, trigger, to) => {
    expect(transition(from, trigger)).toEqual({ ok: true, fulfilment: to })
  })

  test("a provider cancellation after courier confirmation drops any half-recorded handover", () => {
    expect(
      transition(
        { method: "delivery", state: "courier_confirmed", handover: { staff: { actor, at } } },
        { source: "provider", type: "cancelled", at },
      ),
    ).toEqual({ ok: true, fulfilment: { method: "delivery", state: "packed" } })
  })

  describe("handover to the courier needs both the staff tap and the provider pickup", () => {
    const tappedAt = "2026-09-26T11:00:00.000Z"
    const pickedUpAt = "2026-09-26T11:05:00.000Z"
    const staffTap = { source: "staff", type: "confirm_handover", actor, at: tappedAt } as const
    const pickup = { source: "provider", type: "picked_up", at: pickedUpAt } as const
    const handedOver: Fulfilment = {
      method: "delivery",
      state: "handed_to_courier",
      handover: { staff: { actor, at: tappedAt }, pickup: { at: pickedUpAt } },
    }

    test("a staff tap alone is recorded but does not hand the order over", () => {
      expect(transition({ method: "delivery", state: "courier_confirmed", handover: {} }, staffTap)).toEqual({
        ok: true,
        fulfilment: { method: "delivery", state: "courier_confirmed", handover: { staff: { actor, at: tappedAt } } },
      })
    })

    test("a provider pickup alone is recorded but does not hand the order over", () => {
      expect(transition({ method: "delivery", state: "courier_confirmed", handover: {} }, pickup)).toEqual({
        ok: true,
        fulfilment: { method: "delivery", state: "courier_confirmed", handover: { pickup: { at: pickedUpAt } } },
      })
    })

    test("the provider pickup completes a handover the staff already tapped", () => {
      expect(
        transition({ method: "delivery", state: "courier_confirmed", handover: { staff: { actor, at: tappedAt } } }, pickup),
      ).toEqual({ ok: true, fulfilment: handedOver })
    })

    test("the staff tap completes a handover the provider already reported", () => {
      expect(
        transition({ method: "delivery", state: "courier_confirmed", handover: { pickup: { at: pickedUpAt } } }, staffTap),
      ).toEqual({ ok: true, fulfilment: handedOver })
    })

    test("a second staff tap is rejected", () => {
      expect(
        transition({ method: "delivery", state: "courier_confirmed", handover: { staff: { actor, at: tappedAt } } }, staffTap),
      ).toEqual({
        ok: false,
        error: {
          code: "forbidden_transition",
          from: "courier_confirmed",
          trigger: { source: "staff", type: "confirm_handover" },
        },
      })
    })

    test("a repeated provider pickup is rejected", () => {
      expect(
        transition({ method: "delivery", state: "courier_confirmed", handover: { pickup: { at: pickedUpAt } } }, pickup),
      ).toEqual({
        ok: false,
        error: {
          code: "forbidden_transition",
          from: "courier_confirmed",
          trigger: { source: "provider", type: "picked_up" },
        },
      })
    })
  })

  describe("after handover", () => {
    const handover = { staff: { actor, at }, pickup: { at } }

    test("the provider reporting transit moves a handed-over order in transit", () => {
      expect(
        transition({ method: "delivery", state: "handed_to_courier", handover }, { source: "provider", type: "in_transit", at }),
      ).toEqual({ ok: true, fulfilment: { method: "delivery", state: "in_transit", handover } })
    })

    test("the provider reporting delivery completes an order in transit", () => {
      expect(
        transition({ method: "delivery", state: "in_transit", handover }, { source: "provider", type: "delivered", at }),
      ).toEqual({ ok: true, fulfilment: { method: "delivery", state: "delivered", handover } })
    })

    test("the provider reporting delivery completes a handed-over order whose transit it never reported", () => {
      expect(
        transition({ method: "delivery", state: "handed_to_courier", handover }, { source: "provider", type: "delivered", at }),
      ).toEqual({ ok: true, fulfilment: { method: "delivery", state: "delivered", handover } })
    })
  })

  describe("the courier moving on before staff confirm the handover", () => {
    const pickedUpAt = "2026-09-26T11:00:00.000Z"
    const transitAt = "2026-09-26T11:30:00.000Z"
    const deliveredAt = "2026-09-26T13:00:00.000Z"
    const tappedAt = "2026-09-26T14:00:00.000Z"
    const staffTap = { source: "staff", type: "confirm_handover", actor, at: tappedAt } as const
    const inTransit = { source: "provider", type: "in_transit", at: transitAt } as const
    const delivered = { source: "provider", type: "delivered", at: deliveredAt } as const

    test("transit reported before any pickup counts as the pickup, and is remembered, but doesn't move the order", () => {
      expect(transition({ method: "delivery", state: "courier_confirmed", handover: {} }, inTransit)).toEqual({
        ok: true,
        fulfilment: {
          method: "delivery",
          state: "courier_confirmed",
          handover: { pickup: { at: transitAt }, reported: [{ state: "in_transit", at: transitAt }] },
        },
      })
    })

    test("the staff tap then completes the handover and the order catches up with the courier", () => {
      const waiting: Fulfilment = {
        method: "delivery",
        state: "courier_confirmed",
        handover: { pickup: { at: pickedUpAt }, reported: [{ state: "in_transit", at: transitAt }] },
      }
      expect(transition(waiting, staffTap)).toEqual({
        ok: true,
        fulfilment: { method: "delivery", state: "in_transit", handover: { staff: { actor, at: tappedAt }, pickup: { at: pickedUpAt } } },
      })
    })

    test("an order the courier already delivered is delivered once staff confirm the handover", () => {
      const reported = transition({ method: "delivery", state: "courier_confirmed", handover: { pickup: { at: pickedUpAt } } }, inTransit)
      const deliveredFirst = reported.ok && transition(reported.fulfilment, delivered)
      expect(deliveredFirst && deliveredFirst.ok && deliveredFirst.fulfilment).toEqual({
        method: "delivery",
        state: "courier_confirmed",
        handover: {
          pickup: { at: pickedUpAt },
          reported: [
            { state: "in_transit", at: transitAt },
            { state: "delivered", at: deliveredAt },
          ],
        },
      })
      const handedOver = deliveredFirst && deliveredFirst.ok && transition(deliveredFirst.fulfilment, staffTap)
      expect(handedOver && handedOver.ok && handedOver.fulfilment.state).toBe("delivered")
    })

    test("transit after staff tapped completes the handover and moves the order in transit", () => {
      expect(
        transition({ method: "delivery", state: "courier_confirmed", handover: { staff: { actor, at: tappedAt } } }, inTransit),
      ).toEqual({
        ok: true,
        fulfilment: { method: "delivery", state: "in_transit", handover: { staff: { actor, at: tappedAt }, pickup: { at: transitAt } } },
      })
    })

    test("a pickup reported before the courier's confirmation (a late or lost webhook) confirms it and counts", () => {
      expect(transition({ method: "delivery", state: "label_booked" }, { source: "provider", type: "picked_up", at: pickedUpAt })).toEqual({
        ok: true,
        fulfilment: { method: "delivery", state: "courier_confirmed", handover: { pickup: { at: pickedUpAt } } },
      })
      const ahead = transition({ method: "delivery", state: "label_booked" }, inTransit)
      expect(ahead.ok && ahead.fulfilment).toEqual({
        method: "delivery",
        state: "courier_confirmed",
        handover: { pickup: { at: transitAt }, reported: [{ state: "in_transit", at: transitAt }] },
      })
    })

    test("the same status reported twice, or transit after delivery, is refused", () => {
      const reported: Fulfilment = {
        method: "delivery",
        state: "courier_confirmed",
        handover: { pickup: { at: pickedUpAt }, reported: [{ state: "delivered", at: deliveredAt }] },
      }
      expect(transition(reported, delivered).ok).toBe(false)
      expect(transition(reported, inTransit).ok).toBe(false)
    })
  })

  test("a trigger only counts from its own source", () => {
    // e.g. an untrusted provider payload claiming to be a staff action
    const spoofed = { source: "provider", type: "accept", at } as unknown as DeliveryTrigger
    expect(transition(newFulfilment("delivery"), spoofed)).toEqual({
      ok: false,
      error: { code: "forbidden_transition", from: "new", trigger: { source: "provider", type: "accept" } },
    })
  })

  test("an order cannot be accepted twice", () => {
    expect(transition({ method: "delivery", state: "accepted" }, { source: "staff", type: "accept", actor, at })).toEqual({
      ok: false,
      error: { code: "forbidden_transition", from: "accepted", trigger: { source: "staff", type: "accept" } },
    })
  })
})


describe("the pickup path", () => {
  const collect = { source: "staff", type: "collect", actor, at, collectedBy: "Tunde Bakare" } as const
  const holdExpired = { source: "system", type: "pickup_hold_expired", at } as const

  test("a new pickup order starts New, as a delivery order does", () => {
    expect(newFulfilment("pickup")).toEqual({ method: "pickup", state: "new" })
  })

  test("a pickup order shares the start with delivery, keeping its method", () => {
    let fulfilment: Fulfilment = newFulfilment("pickup")
    for (const type of ["accept", "start_picking", "mark_partially_available", "resume_picking"] as const) {
      const result: TransitionResult = transition(fulfilment, { source: "staff", type, actor, at })
      if (!result.ok) throw new Error(`${type} refused`)
      fulfilment = result.fulfilment
    }
    expect(fulfilment).toEqual({ method: "pickup", state: "picking" })
  })

  test("Mark packed on a pickup order lands straight in Ready for pickup", () => {
    expect(transition({ method: "pickup", state: "picking" }, { source: "staff", type: "mark_packed", actor, at })).toEqual({
      ok: true,
      fulfilment: { method: "pickup", state: "ready_for_pickup" },
    })
    expect(
      transition({ method: "pickup", state: "partially_available" }, { source: "staff", type: "mark_packed", actor, at }),
    ).toEqual({ ok: true, fulfilment: { method: "pickup", state: "ready_for_pickup" } })
  })

  test("staff verifying the code collect a ready order, recording who handed it over, when, and to whom", () => {
    expect(transition({ method: "pickup", state: "ready_for_pickup" }, collect)).toEqual({
      ok: true,
      fulfilment: { method: "pickup", state: "collected", collection: { actor, at, collectedBy: "Tunde Bakare" } },
    })
  })

  test("a pickup order not accepted in time is rejected, as a delivery order is", () => {
    expect(transition(newFulfilment("pickup"), { source: "system", type: "accept_deadline_passed", at })).toEqual({
      ok: true,
      fulfilment: { method: "pickup", state: "rejected", rejectedBy: "accept_deadline" },
    })
  })

  test("label and courier events are refused on a pickup order", () => {
    const ready = { method: "pickup", state: "ready_for_pickup" } as const
    for (const type of ["label_created", "confirmed", "picked_up", "in_transit", "delivered", "cancelled"] as const) {
      // @ts-expect-error the types forbid courier events on a pickup order
      expect(transition(ready, { source: "provider", type, at }).ok).toBe(false)
    }
    // @ts-expect-error nor does staff's courier handover apply
    expect(transition(ready, { source: "staff", type: "confirm_handover", actor, at }).ok).toBe(false)
  })

  test("code events are refused on a delivery order", () => {
    const packed = { method: "delivery", state: "packed" } as const
    // @ts-expect-error the types forbid code events on a delivery order
    expect(transition(packed, collect)).toEqual({
      ok: false,
      error: { code: "forbidden_transition", from: "packed", trigger: { source: "staff", type: "collect" } },
    })
  })

  test("a code is accepted only in Ready for pickup", () => {
    for (const state of ["new", "accepted", "picking", "partially_available"] as const) {
      expect(transition({ method: "pickup", state }, collect).ok).toBe(false)
    }
    const collected: Fulfilment = { method: "pickup", state: "collected", collection: { actor, at, collectedBy: "Ada" } }
    expect(transition(collected, collect).ok).toBe(false)
  })

  test("an order whose hold expires uncollected is Not collected (#32)", () => {
    expect(transition({ method: "pickup", state: "ready_for_pickup" }, holdExpired)).toEqual({
      ok: true,
      fulfilment: { method: "pickup", state: "not_collected" },
    })
  })

  test("Not collected is final: the code stops working and the hold can't expire again", () => {
    const notCollected = { method: "pickup", state: "not_collected" } as const
    expect(transition(notCollected, collect)).toEqual({
      ok: false,
      error: { code: "forbidden_transition", from: "not_collected", trigger: { source: "staff", type: "collect" } },
    })
    expect(transition(notCollected, holdExpired).ok).toBe(false)
  })

  test("a hold expires only on an order ready for pickup", () => {
    for (const state of ["new", "accepted", "picking", "partially_available"] as const) {
      expect(transition({ method: "pickup", state }, holdExpired).ok).toBe(false)
    }
    const collected: Fulfilment = { method: "pickup", state: "collected", collection: { actor, at, collectedBy: "Ada" } }
    expect(transition(collected, holdExpired).ok).toBe(false)
    expect(transition({ method: "delivery", state: "packed" }, holdExpired).ok).toBe(false)
  })
})

/**
 * Every state of each method against every trigger. The expected next states below are
 * written out by hand from the spec (docs/design.md, issues #8 and #12), not read from
 * the implementation, so a transition added or removed by mistake fails here.
 */
describe("cancelling an accepted order (#17)", () => {
  test("records who cancelled it, when, and why, keeping its method", () => {
    const result = transition(
      { method: "pickup", state: "partially_available" },
      { source: "staff", type: "cancel", actor, at, reason: "items_unavailable" }
    )

    expect(result).toEqual({
      ok: true,
      fulfilment: {
        method: "pickup",
        state: "cancelled",
        cancellation: { by: "seller", actor, at, reason: "items_unavailable", note: null },
      },
    })
  })

  test("an operator's cancellation is Oja's, with its note", () => {
    const result = transition(
      { method: "delivery", state: "packed" },
      { source: "operator", type: "cancel", actor: "user_1", at, reason: "other", note: "Shop closed for good" }
    )

    expect(result.ok && result.fulfilment).toEqual({
      method: "delivery",
      state: "cancelled",
      cancellation: { by: "operator", actor: "user_1", at, reason: "other", note: "Shop closed for good" },
    })
  })

  test("is refused once a courier label is booked, and before the order is accepted", () => {
    const cancel = { source: "staff", type: "cancel", actor, at, reason: "buyer_asked" } as const
    expect(transition({ method: "delivery", state: "label_booked" }, cancel).ok).toBe(false)
    expect(transition({ method: "delivery", state: "courier_confirmed", handover: {} }, cancel).ok).toBe(false)
    expect(transition({ method: "delivery", state: "new" }, cancel).ok).toBe(false)
  })

  test("canCancel says which states offer it", () => {
    const offered: FulfilmentState[] = ["accepted", "picking", "partially_available", "packed", "ready_for_pickup"]
    const refused: FulfilmentState[] = ["new", "rejected", "label_booked", "delivered", "collected", "not_collected", "cancelled"]
    expect(offered.filter(canCancel)).toEqual(offered)
    expect(refused.filter(canCancel)).toEqual([])
  })
})

describe("transition table", () => {
  const handover = { staff: { actor, at }, pickup: { at } }
  const collection = { actor, at, collectedBy: "Ada Obi" }
  const cancellation = { by: "seller" as const, actor, at, reason: "items_unavailable" as const, note: null }
  const fixtures: Record<FulfilmentMethod, Partial<Record<FulfilmentState, Fulfilment>>> = {
    delivery: {
      new: { method: "delivery", state: "new" },
      accepted: { method: "delivery", state: "accepted" },
      rejected: { method: "delivery", state: "rejected", rejectedBy: "seller" },
      picking: { method: "delivery", state: "picking" },
      partially_available: { method: "delivery", state: "partially_available" },
      packed: { method: "delivery", state: "packed" },
      label_booked: { method: "delivery", state: "label_booked" },
      courier_confirmed: { method: "delivery", state: "courier_confirmed", handover: {} },
      handed_to_courier: { method: "delivery", state: "handed_to_courier", handover },
      in_transit: { method: "delivery", state: "in_transit", handover },
      delivered: { method: "delivery", state: "delivered", handover },
      cancelled: { method: "delivery", state: "cancelled", cancellation },
    },
    pickup: {
      new: { method: "pickup", state: "new" },
      accepted: { method: "pickup", state: "accepted" },
      rejected: { method: "pickup", state: "rejected", rejectedBy: "seller" },
      picking: { method: "pickup", state: "picking" },
      partially_available: { method: "pickup", state: "partially_available" },
      ready_for_pickup: { method: "pickup", state: "ready_for_pickup" },
      collected: { method: "pickup", state: "collected", collection },
      not_collected: { method: "pickup", state: "not_collected" },
      cancelled: { method: "pickup", state: "cancelled", cancellation },
    },
  }

  const triggers: FulfilmentTrigger[] = [
    { source: "staff", type: "accept", actor, at },
    { source: "staff", type: "reject", actor, at },
    { source: "staff", type: "start_picking", actor, at },
    { source: "staff", type: "mark_partially_available", actor, at },
    { source: "staff", type: "resume_picking", actor, at },
    { source: "staff", type: "mark_packed", actor, at },
    { source: "staff", type: "confirm_handover", actor, at },
    { source: "staff", type: "collect", actor, at, collectedBy: "Ada Obi" },
    { source: "provider", type: "label_created", at },
    { source: "provider", type: "confirmed", at },
    { source: "provider", type: "picked_up", at },
    { source: "provider", type: "in_transit", at },
    { source: "provider", type: "delivered", at },
    { source: "provider", type: "cancelled", at },
    { source: "system", type: "accept_deadline_passed", at },
    { source: "system", type: "pickup_hold_expired", at },
    { source: "staff", type: "cancel", actor, at, reason: "items_unavailable" },
    { source: "operator", type: "cancel", actor: "user_1", at, reason: "other", note: "Shop closed for good" },
  ]

  type Moves = Partial<Record<FulfilmentState, Record<string, FulfilmentState>>>

  // An accepted order not yet handed on (no courier label booked, not collected) can be cancelled (#17).
  const cancels = { "staff:cancel": "cancelled", "operator:cancel": "cancelled" } as const

  // Both methods share the start.
  const start: Moves = {
    new: {
      "staff:accept": "accepted",
      "staff:reject": "rejected",
      "system:accept_deadline_passed": "rejected",
    },
    accepted: { "staff:start_picking": "picking", ...cancels },
    rejected: {},
    cancelled: {},
  }

  // Allowed moves as "source:type" -> next state; anything not listed is forbidden.
  // A lone handover half keeps the order in courier_confirmed (see the handover tests).
  const allowed: Record<FulfilmentMethod, Moves> = {
    delivery: {
      ...start,
      picking: {
        "staff:mark_packed": "packed",
        "staff:mark_partially_available": "partially_available",
        ...cancels,
      },
      partially_available: {
        "staff:resume_picking": "picking",
        "staff:mark_packed": "packed",
        ...cancels,
      },
      packed: { "provider:label_created": "label_booked", ...cancels },
      label_booked: {
        "provider:confirmed": "courier_confirmed",
        // The courier moving the parcel means it confirmed, whether or not that webhook came.
        "provider:picked_up": "courier_confirmed",
        "provider:in_transit": "courier_confirmed",
        "provider:delivered": "courier_confirmed",
        "provider:cancelled": "packed",
      },
      courier_confirmed: {
        "staff:confirm_handover": "courier_confirmed",
        "provider:picked_up": "courier_confirmed",
        // Reported ahead of the staff tap: remembered until it comes (see above).
        "provider:in_transit": "courier_confirmed",
        "provider:delivered": "courier_confirmed",
        "provider:cancelled": "packed",
      },
      handed_to_courier: { "provider:in_transit": "in_transit", "provider:delivered": "delivered" },
      in_transit: { "provider:delivered": "delivered" },
      delivered: {},
    },
    pickup: {
      ...start,
      picking: {
        "staff:mark_packed": "ready_for_pickup",
        "staff:mark_partially_available": "partially_available",
        ...cancels,
      },
      partially_available: {
        "staff:resume_picking": "picking",
        "staff:mark_packed": "ready_for_pickup",
        ...cancels,
      },
      // Ready for pickup is a pickup order's Packed: nothing has left the shop yet.
      ready_for_pickup: { "staff:collect": "collected", "system:pickup_hold_expired": "not_collected", ...cancels },
      collected: {},
      not_collected: {},
    },
  }

  for (const method of ["delivery", "pickup"] as const) {
    for (const [from, fulfilment] of Object.entries(fixtures[method]) as [FulfilmentState, Fulfilment][]) {
      for (const trigger of triggers) {
        const key = `${trigger.source}:${trigger.type}`
        const expected = allowed[method][from]?.[key]

        if (expected) {
          test(`${method}: ${from} + ${key} -> ${expected}`, () => {
            const result = transition(fulfilment, trigger)
            expect(result.ok && result.fulfilment).toMatchObject({ method, state: expected })
          })
        } else {
          test(`${method}: ${from} + ${key} is forbidden`, () => {
            expect(transition(fulfilment, trigger)).toEqual({
              ok: false,
              error: {
                code: "forbidden_transition",
                from,
                trigger: { source: trigger.source, type: trigger.type },
              },
            })
          })
        }
      }
    }
  }
})
