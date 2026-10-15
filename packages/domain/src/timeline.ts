import type { Fulfilment, FulfilmentMethod, FulfilmentState } from "./fulfilment"

/**
 * An order's fulfilment as a timeline (#25): when it reached each state, and the steps the buyer
 * and staff are shown along its method's path, done up to where the order is.
 */

/** When the order last reached each state (ISO 8601); a state it never reached isn't listed. */
export type Reached = Partial<Record<FulfilmentState, string>>

/**
 * The record after a transition from `previous` to `next` by a trigger at `at`. A completed
 * handover is reached when the courier picked the parcel up; one completed after the courier had
 * moved on also records each state the courier reported, at the time it reported it; a transition that leaves the state as it was (half a handover) records nothing.
 */
export function recordReached(reached: Reached, previous: Fulfilment, next: Fulfilment, at: string): Reached {
  if (next.state === previous.state) return reached
  if (previous.state !== "courier_confirmed" || next.state === "packed") return { ...reached, [next.state]: at }
  // Handed over when the courier picked it up, so the steps' times never run backwards.
  const handedOverAt = "handover" in next && next.handover.pickup ? next.handover.pickup.at : at
  const known: Reached = {
    handed_to_courier: handedOverAt,
    ...Object.fromEntries((previous.handover.reported ?? []).map((r) => [r.state, r.at])),
  }
  return { ...reached, ...known, [next.state]: known[next.state] ?? at }
}

export type TimelineStep = { label: string; status: "done" | "current" | "upcoming"; at: string | null }

type Step = { label: string; states: FulfilmentState[] }
type Audience = "buyer" | "staff"

/** The steps both methods start with, as each audience reads them. */
const START: Record<Audience, Step[]> = {
  // Staff's finer steps read as one to the buyer, as on the status chip (`orderStatus`).
  buyer: [
    { label: "Order placed", states: ["new"] },
    { label: "Accepted", states: ["accepted"] },
    { label: "Being prepared", states: ["picking", "partially_available"] },
  ],
  staff: [
    { label: "Placed", states: ["new"] },
    { label: "Accepted", states: ["accepted"] },
    { label: "Picking", states: ["picking", "partially_available"] },
  ],
}

const PICKUP_STEPS: Step[] = [
  { label: "Ready for pickup", states: ["ready_for_pickup"] },
  { label: "Collected", states: ["collected"] },
]

/** A pickup order whose hold expired (#32) ends there instead of at Collected. */
const NOT_COLLECTED_STEPS: Step[] = [...PICKUP_STEPS.slice(0, -1), { label: "Not collected", states: ["not_collected"] }]

const STEPS: Record<FulfilmentMethod, Record<Audience, Step[]>> = {
  delivery: {
    buyer: [
      ...START.buyer,
      { label: "Packed", states: ["packed"] },
      { label: "Courier booked", states: ["label_booked", "courier_confirmed"] },
      { label: "Picked up by the courier", states: ["handed_to_courier"] },
      { label: "On its way", states: ["in_transit"] },
      { label: "Delivered", states: ["delivered"] },
    ],
    staff: [
      ...START.staff,
      { label: "Packed", states: ["packed"] },
      { label: "Label booked", states: ["label_booked"] },
      { label: "Courier confirmed", states: ["courier_confirmed"] },
      { label: "Handed to courier", states: ["handed_to_courier"] },
      { label: "In transit", states: ["in_transit"] },
      { label: "Delivered", states: ["delivered"] },
    ],
  },
  pickup: {
    buyer: [...START.buyer, ...PICKUP_STEPS],
    staff: [...START.staff, ...PICKUP_STEPS],
  },
}

/** Where each path ends, every step done. */
const FINAL = new Set<FulfilmentState>(["delivered", "collected", "not_collected"])

/**
 * The order's steps for the buyer or staff along its method's path: done up to the one it is at,
 * which is current (done, once delivered, collected or not collected), each done step with when the order got
 * there. A rejected order has none.
 */
export function fulfilmentTimeline(
  {
    method,
    state,
    placed_at,
    reached,
  }: { method: FulfilmentMethod; state: FulfilmentState; placed_at: string; reached: Reached },
  audience: Audience,
): TimelineStep[] {
  const steps = state === "not_collected" ? [...START[audience], ...NOT_COLLECTED_STEPS] : STEPS[method][audience]
  const current = steps.findIndex((s) => s.states.includes(state))
  if (current < 0) return []
  const timeOf = ({ states }: Step) =>
    states.includes("new") ? placed_at : (states.map((s) => reached[s]).find((at) => at != null) ?? null)
  return steps.map((step, i) => {
    if (i > current) return { label: step.label, status: "upcoming", at: null }
    const status = i < current || FINAL.has(state) ? "done" : "current"
    return { label: step.label, status, at: timeOf(step) }
  })
}
