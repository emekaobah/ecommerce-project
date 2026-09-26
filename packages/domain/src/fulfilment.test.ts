import { describe, expect, test } from "bun:test"
import {
  newFulfilment,
  transition,
  type Fulfilment,
  type FulfilmentState,
  type FulfilmentTrigger,
} from "./fulfilment"

const at = "2026-09-26T10:00:00.000Z"
const actor = "mem_staff_1"

describe("transition", () => {
  test("a new order is accepted by a staff action", () => {
    expect(transition(newFulfilment(), { source: "staff", type: "accept", actor, at })).toEqual({
      ok: true,
      fulfilment: { state: "accepted" },
    })
  })

  test("a new order is rejected by the seller", () => {
    expect(transition(newFulfilment(), { source: "staff", type: "reject", actor, at })).toEqual({
      ok: true,
      fulfilment: { state: "rejected", rejectedBy: "seller" },
    })
  })

  test("a new order is rejected when the accept deadline passes", () => {
    expect(transition(newFulfilment(), { source: "system", type: "accept_deadline_passed", at })).toEqual({
      ok: true,
      fulfilment: { state: "rejected", rejectedBy: "accept_deadline" },
    })
  })

  test("staff start picking an accepted order", () => {
    expect(transition({ state: "accepted" }, { source: "staff", type: "start_picking", actor, at })).toEqual({
      ok: true,
      fulfilment: { state: "picking" },
    })
  })

  test("staff mark a picked order packed", () => {
    expect(transition({ state: "picking" }, { source: "staff", type: "mark_packed", actor, at })).toEqual({
      ok: true,
      fulfilment: { state: "packed" },
    })
  })

  test("staff flag that items are not all available while picking", () => {
    expect(
      transition({ state: "picking" }, { source: "staff", type: "mark_partially_available", actor, at }),
    ).toEqual({ ok: true, fulfilment: { state: "partially_available" } })
  })

  test("staff resume picking once the order has been edited", () => {
    expect(
      transition({ state: "partially_available" }, { source: "staff", type: "resume_picking", actor, at }),
    ).toEqual({ ok: true, fulfilment: { state: "picking" } })
  })

  test("staff pack what is available", () => {
    expect(
      transition({ state: "partially_available" }, { source: "staff", type: "mark_packed", actor, at }),
    ).toEqual({ ok: true, fulfilment: { state: "packed" } })
  })

  test("the provider creating a label books it for a packed order", () => {
    expect(transition({ state: "packed" }, { source: "provider", type: "label_created", at })).toEqual({
      ok: true,
      fulfilment: { state: "label_booked" },
    })
  })

  test("the provider confirming a courier moves a booked label on, with no handover recorded yet", () => {
    expect(transition({ state: "label_booked" }, { source: "provider", type: "confirmed", at })).toEqual({
      ok: true,
      fulfilment: { state: "courier_confirmed", handover: {} },
    })
  })

  test("a provider cancellation sends a booked label back to packed for rebooking", () => {
    expect(transition({ state: "label_booked" }, { source: "provider", type: "cancelled", at })).toEqual({
      ok: true,
      fulfilment: { state: "packed" },
    })
  })

  test("a provider cancellation after courier confirmation drops any half-recorded handover", () => {
    expect(
      transition(
        { state: "courier_confirmed", handover: { staff: { actor, at } } },
        { source: "provider", type: "cancelled", at },
      ),
    ).toEqual({ ok: true, fulfilment: { state: "packed" } })
  })

  describe("handover to the courier needs both the staff tap and the provider pickup", () => {
    const tappedAt = "2026-09-26T11:00:00.000Z"
    const pickedUpAt = "2026-09-26T11:05:00.000Z"
    const staffTap = { source: "staff", type: "confirm_handover", actor, at: tappedAt } as const
    const pickup = { source: "provider", type: "picked_up", at: pickedUpAt } as const
    const handedOver: Fulfilment = {
      state: "handed_to_courier",
      handover: { staff: { actor, at: tappedAt }, pickup: { at: pickedUpAt } },
    }

    test("a staff tap alone is recorded but does not hand the order over", () => {
      expect(transition({ state: "courier_confirmed", handover: {} }, staffTap)).toEqual({
        ok: true,
        fulfilment: { state: "courier_confirmed", handover: { staff: { actor, at: tappedAt } } },
      })
    })

    test("a provider pickup alone is recorded but does not hand the order over", () => {
      expect(transition({ state: "courier_confirmed", handover: {} }, pickup)).toEqual({
        ok: true,
        fulfilment: { state: "courier_confirmed", handover: { pickup: { at: pickedUpAt } } },
      })
    })

    test("the provider pickup completes a handover the staff already tapped", () => {
      expect(
        transition({ state: "courier_confirmed", handover: { staff: { actor, at: tappedAt } } }, pickup),
      ).toEqual({ ok: true, fulfilment: handedOver })
    })

    test("the staff tap completes a handover the provider already reported", () => {
      expect(
        transition({ state: "courier_confirmed", handover: { pickup: { at: pickedUpAt } } }, staffTap),
      ).toEqual({ ok: true, fulfilment: handedOver })
    })

    test("a second staff tap is rejected", () => {
      expect(
        transition({ state: "courier_confirmed", handover: { staff: { actor, at: tappedAt } } }, staffTap),
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
        transition({ state: "courier_confirmed", handover: { pickup: { at: pickedUpAt } } }, pickup),
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
        transition({ state: "handed_to_courier", handover }, { source: "provider", type: "in_transit", at }),
      ).toEqual({ ok: true, fulfilment: { state: "in_transit", handover } })
    })

    test("the provider reporting delivery completes an order in transit", () => {
      expect(
        transition({ state: "in_transit", handover }, { source: "provider", type: "delivered", at }),
      ).toEqual({ ok: true, fulfilment: { state: "delivered", handover } })
    })
  })

  test("a trigger only counts from its own source", () => {
    // e.g. an untrusted provider payload claiming to be a staff action
    const spoofed = { source: "provider", type: "accept", at } as unknown as FulfilmentTrigger
    expect(transition(newFulfilment(), spoofed)).toEqual({
      ok: false,
      error: { code: "forbidden_transition", from: "new", trigger: { source: "provider", type: "accept" } },
    })
  })

  test("an order cannot be accepted twice", () => {
    expect(transition({ state: "accepted" }, { source: "staff", type: "accept", actor, at })).toEqual({
      ok: false,
      error: { code: "forbidden_transition", from: "accepted", trigger: { source: "staff", type: "accept" } },
    })
  })
})

/**
 * Every state against every trigger. The expected next states below are
 * written out by hand from the spec (docs/design.md, issue #8), not read from
 * the implementation, so a transition added or removed by mistake fails here.
 */
describe("transition table", () => {
  const handover = { staff: { actor, at }, pickup: { at } }
  const fixtures = {
    new: { state: "new" },
    accepted: { state: "accepted" },
    rejected: { state: "rejected", rejectedBy: "seller" },
    picking: { state: "picking" },
    partially_available: { state: "partially_available" },
    packed: { state: "packed" },
    label_booked: { state: "label_booked" },
    courier_confirmed: { state: "courier_confirmed", handover: {} },
    handed_to_courier: { state: "handed_to_courier", handover },
    in_transit: { state: "in_transit", handover },
    delivered: { state: "delivered", handover },
  } satisfies Record<FulfilmentState, Fulfilment>

  const triggers: FulfilmentTrigger[] = [
    { source: "staff", type: "accept", actor, at },
    { source: "staff", type: "reject", actor, at },
    { source: "staff", type: "start_picking", actor, at },
    { source: "staff", type: "mark_partially_available", actor, at },
    { source: "staff", type: "resume_picking", actor, at },
    { source: "staff", type: "mark_packed", actor, at },
    { source: "staff", type: "confirm_handover", actor, at },
    { source: "provider", type: "label_created", at },
    { source: "provider", type: "confirmed", at },
    { source: "provider", type: "picked_up", at },
    { source: "provider", type: "in_transit", at },
    { source: "provider", type: "delivered", at },
    { source: "provider", type: "cancelled", at },
    { source: "system", type: "accept_deadline_passed", at },
  ]

  // Allowed moves as "source:type" -> next state; anything not listed is forbidden.
  // A lone handover half keeps the order in courier_confirmed (see the handover tests).
  const allowed: Record<FulfilmentState, Record<string, FulfilmentState>> = {
    new: {
      "staff:accept": "accepted",
      "staff:reject": "rejected",
      "system:accept_deadline_passed": "rejected",
    },
    accepted: { "staff:start_picking": "picking" },
    rejected: {},
    picking: {
      "staff:mark_packed": "packed",
      "staff:mark_partially_available": "partially_available",
    },
    partially_available: {
      "staff:resume_picking": "picking",
      "staff:mark_packed": "packed",
    },
    packed: { "provider:label_created": "label_booked" },
    label_booked: {
      "provider:confirmed": "courier_confirmed",
      "provider:cancelled": "packed",
    },
    courier_confirmed: {
      "staff:confirm_handover": "courier_confirmed",
      "provider:picked_up": "courier_confirmed",
      "provider:cancelled": "packed",
    },
    handed_to_courier: { "provider:in_transit": "in_transit" },
    in_transit: { "provider:delivered": "delivered" },
    delivered: {},
  }

  for (const [from, fulfilment] of Object.entries(fixtures) as [FulfilmentState, Fulfilment][]) {
    for (const trigger of triggers) {
      const key = `${trigger.source}:${trigger.type}`
      const expected = allowed[from][key]

      if (expected) {
        test(`${from} + ${key} -> ${expected}`, () => {
          const result = transition(fulfilment, trigger)
          expect(result.ok && result.fulfilment.state).toBe(expected)
        })
      } else {
        test(`${from} + ${key} is forbidden`, () => {
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
})
