import { describe, expect, test } from "bun:test"
import {
  newFulfilment,
  transition,
  type Fulfilment,
  type FulfilmentState,
  type FulfilmentTrigger,
  type ProviderEventType,
  type StaffActionType,
} from "./fulfilment"

const at = "2026-09-26T10:00:00.000Z"
const actor = "mem_staff_1"

describe("transition", () => {
  const staff = (type: StaffActionType): FulfilmentTrigger => ({ source: "staff", type, actor, at })
  const provider = (type: ProviderEventType): FulfilmentTrigger => ({ source: "provider", type, at })

  test.each<[string, Fulfilment, FulfilmentTrigger, Fulfilment]>([
    ["a new order is accepted by a staff action", newFulfilment(), staff("accept"), { state: "accepted" }],
    [
      "a new order is rejected by the seller",
      newFulfilment(),
      staff("reject"),
      { state: "rejected", rejectedBy: "seller" },
    ],
    [
      "a new order is rejected when the accept deadline passes",
      newFulfilment(),
      { source: "system", type: "accept_deadline_passed", at },
      { state: "rejected", rejectedBy: "accept_deadline" },
    ],
    [
      "staff start picking an accepted order",
      { state: "accepted" },
      staff("start_picking"),
      { state: "picking" },
    ],
    ["staff mark a picked order packed", { state: "picking" }, staff("mark_packed"), { state: "packed" }],
    [
      "staff flag that items are not all available while picking",
      { state: "picking" },
      staff("mark_partially_available"),
      { state: "partially_available" },
    ],
    [
      "staff resume picking once the order has been edited",
      { state: "partially_available" },
      staff("resume_picking"),
      { state: "picking" },
    ],
    [
      "staff pack what is available",
      { state: "partially_available" },
      staff("mark_packed"),
      { state: "packed" },
    ],
    [
      "the provider creating a label books it for a packed order",
      { state: "packed" },
      provider("label_created"),
      { state: "label_booked" },
    ],
    [
      "the provider confirming a courier moves a booked label on, with no handover recorded yet",
      { state: "label_booked" },
      provider("confirmed"),
      { state: "courier_confirmed", handover: {} },
    ],
    [
      "a provider cancellation sends a booked label back to packed for rebooking",
      { state: "label_booked" },
      provider("cancelled"),
      { state: "packed" },
    ],
  ])("%s", (_name, from, trigger, to) => {
    expect(transition(from, trigger)).toEqual({ ok: true, fulfilment: to })
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

    test("the provider reporting delivery completes a handed-over order whose transit it never reported", () => {
      expect(
        transition({ state: "handed_to_courier", handover }, { source: "provider", type: "delivered", at }),
      ).toEqual({ ok: true, fulfilment: { state: "delivered", handover } })
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
      expect(transition({ state: "courier_confirmed", handover: {} }, inTransit)).toEqual({
        ok: true,
        fulfilment: {
          state: "courier_confirmed",
          handover: { pickup: { at: transitAt }, reported: [{ state: "in_transit", at: transitAt }] },
        },
      })
    })

    test("the staff tap then completes the handover and the order catches up with the courier", () => {
      const waiting: Fulfilment = {
        state: "courier_confirmed",
        handover: { pickup: { at: pickedUpAt }, reported: [{ state: "in_transit", at: transitAt }] },
      }
      expect(transition(waiting, staffTap)).toEqual({
        ok: true,
        fulfilment: { state: "in_transit", handover: { staff: { actor, at: tappedAt }, pickup: { at: pickedUpAt } } },
      })
    })

    test("an order the courier already delivered is delivered once staff confirm the handover", () => {
      const reported = transition({ state: "courier_confirmed", handover: { pickup: { at: pickedUpAt } } }, inTransit)
      const deliveredFirst = reported.ok && transition(reported.fulfilment, delivered)
      expect(deliveredFirst && deliveredFirst.ok && deliveredFirst.fulfilment).toEqual({
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
        transition({ state: "courier_confirmed", handover: { staff: { actor, at: tappedAt } } }, inTransit),
      ).toEqual({
        ok: true,
        fulfilment: { state: "in_transit", handover: { staff: { actor, at: tappedAt }, pickup: { at: transitAt } } },
      })
    })

    test("the same status reported twice, or transit after delivery, is refused", () => {
      const reported: Fulfilment = {
        state: "courier_confirmed",
        handover: { pickup: { at: pickedUpAt }, reported: [{ state: "delivered", at: deliveredAt }] },
      }
      expect(transition(reported, delivered).ok).toBe(false)
      expect(transition(reported, inTransit).ok).toBe(false)
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
      // Reported ahead of the staff tap: remembered until it comes (see above).
      "provider:in_transit": "courier_confirmed",
      "provider:delivered": "courier_confirmed",
      "provider:cancelled": "packed",
    },
    handed_to_courier: { "provider:in_transit": "in_transit", "provider:delivered": "delivered" },
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
