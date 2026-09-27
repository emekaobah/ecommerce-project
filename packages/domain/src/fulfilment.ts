/**
 * The order fulfilment state machine shared by the backend and the vendor app
 * (docs/design.md, "Order state machine").
 *
 *   new → accepted → picking → packed → label_booked → courier_confirmed
 *       → handed_to_courier → in_transit → delivered
 *
 * Branches: new → rejected (seller declines, or the 24h accept deadline
 * passes); picking ⇄ partially_available → packed; label_booked or
 * courier_confirmed → packed when the shipment provider cancels (rebook).
 *
 * Every trigger names its source: a `staff` action (who and when), a
 * shipment-`provider` event, or a `system` event. Provider events are generic
 * (not tied to one courier aggregator), so a provider adapter maps its own
 * webhook statuses onto them.
 *
 * `transition` is pure: it never mutates its input and returns either the next
 * fulfilment or a `forbidden_transition` error.
 */

/** Who confirmed the handover in the app, and when (ISO 8601). */
export type StaffHandover = { actor: string; at: string }
/** When the shipment provider reported the parcel picked up (ISO 8601). */
export type ProviderPickup = { at: string }

/**
 * Handover to the courier needs both halves: a staff tap and the provider's
 * `picked_up`. They arrive independently and in either order, so while the
 * order is `courier_confirmed` each half is recorded as it arrives. The order
 * moves to `handed_to_courier` only on the trigger that supplies the second
 * half; each half can be recorded once. A cancellation drops both.
 */
export type HandoverProgress = { staff?: StaffHandover; pickup?: ProviderPickup }
/** A completed handover, carried forward so later states keep who handed over and when. */
export type Handover = { staff: StaffHandover; pickup: ProviderPickup }

export type Fulfilment =
  | { state: "new" }
  | { state: "accepted" }
  | { state: "rejected"; rejectedBy: "seller" | "accept_deadline" }
  | { state: "picking" }
  | { state: "partially_available" }
  | { state: "packed" }
  | { state: "label_booked" }
  | { state: "courier_confirmed"; handover: HandoverProgress }
  | { state: "handed_to_courier"; handover: Handover }
  | { state: "in_transit"; handover: Handover }
  | { state: "delivered"; handover: Handover }

export type FulfilmentState = Fulfilment["state"]

export type StaffActionType =
  | "accept"
  | "reject"
  | "start_picking"
  | "mark_partially_available"
  | "resume_picking"
  | "mark_packed"
  | "confirm_handover"

/** Events any shipment provider reports, whatever its own status names. */
export type ProviderEventType =
  | "label_created"
  | "confirmed"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "cancelled"

export type SystemEventType = "accept_deadline_passed"

/** An action taken by seller staff in the app; `actor` is the member id. */
export type StaffAction = { source: "staff"; type: StaffActionType; actor: string; at: string }
/** An event reported by the shipment provider. */
export type ProviderEvent = { source: "provider"; type: ProviderEventType; at: string }
/** An event raised by the platform itself, such as a scheduled job. */
export type SystemEvent = { source: "system"; type: SystemEventType; at: string }

export type FulfilmentTrigger = StaffAction | ProviderEvent | SystemEvent

export type TransitionError = {
  code: "forbidden_transition"
  from: FulfilmentState
  trigger: Pick<FulfilmentTrigger, "source" | "type">
}

export type TransitionResult = { ok: true; fulfilment: Fulfilment } | { ok: false; error: TransitionError }

/** The fulfilment of an order that has just been placed. */
export function newFulfilment(): Fulfilment {
  return { state: "new" }
}

/** Applies a trigger to a fulfilment, or explains why it is not allowed. */
export function transition(fulfilment: Fulfilment, trigger: FulfilmentTrigger): TransitionResult {
  const next = nextFulfilment(fulfilment, trigger)
  if (next) return { ok: true, fulfilment: next }
  return {
    ok: false,
    error: {
      code: "forbidden_transition",
      from: fulfilment.state,
      trigger: { source: trigger.source, type: trigger.type },
    },
  }
}

type Step<S extends FulfilmentState> = (
  fulfilment: Extract<Fulfilment, { state: S }>,
  trigger: FulfilmentTrigger,
) => Fulfilment | undefined

const done = () => undefined

/** What each state does with a trigger; `undefined` means the trigger is not allowed there. */
const STEPS: { [S in FulfilmentState]: Step<S> } = {
  new: (_, trigger) => {
    if (isStaff(trigger, "accept")) return { state: "accepted" }
    if (isStaff(trigger, "reject")) return { state: "rejected", rejectedBy: "seller" }
    if (isSystem(trigger, "accept_deadline_passed")) {
      return { state: "rejected", rejectedBy: "accept_deadline" }
    }
    return undefined
  },
  accepted: (_, trigger) => (isStaff(trigger, "start_picking") ? { state: "picking" } : undefined),
  picking: (_, trigger) => {
    if (isStaff(trigger, "mark_packed")) return { state: "packed" }
    if (isStaff(trigger, "mark_partially_available")) return { state: "partially_available" }
    return undefined
  },
  partially_available: (_, trigger) => {
    if (isStaff(trigger, "resume_picking")) return { state: "picking" }
    if (isStaff(trigger, "mark_packed")) return { state: "packed" }
    return undefined
  },
  packed: (_, trigger) => (isProvider(trigger, "label_created") ? { state: "label_booked" } : undefined),
  label_booked: (_, trigger) => {
    if (isProvider(trigger, "confirmed")) return { state: "courier_confirmed", handover: {} }
    if (isProvider(trigger, "cancelled")) return { state: "packed" }
    return undefined
  },
  courier_confirmed: ({ handover }, trigger) => {
    if (isProvider(trigger, "cancelled")) return { state: "packed" }
    if (isStaff(trigger, "confirm_handover") && !handover.staff) {
      return recordHandover({ ...handover, staff: { actor: trigger.actor, at: trigger.at } })
    }
    if (isProvider(trigger, "picked_up") && !handover.pickup) {
      return recordHandover({ ...handover, pickup: { at: trigger.at } })
    }
    return undefined
  },
  handed_to_courier: ({ handover }, trigger) =>
    isProvider(trigger, "in_transit") ? { state: "in_transit", handover } : undefined,
  in_transit: ({ handover }, trigger) =>
    isProvider(trigger, "delivered") ? { state: "delivered", handover } : undefined,
  rejected: done,
  delivered: done,
}

function nextFulfilment(fulfilment: Fulfilment, trigger: FulfilmentTrigger): Fulfilment | undefined {
  // The mapped type pairs each state with its own step; TypeScript can't correlate the union here.
  const step = STEPS[fulfilment.state] as Step<FulfilmentState>
  return step(fulfilment, trigger)
}

function recordHandover(handover: HandoverProgress): Fulfilment {
  const { staff, pickup } = handover
  if (staff && pickup) return { state: "handed_to_courier", handover: { staff, pickup } }
  return { state: "courier_confirmed", handover }
}

function isStaff<T extends StaffActionType>(
  trigger: FulfilmentTrigger,
  type: T,
): trigger is StaffAction & { type: T } {
  return trigger.source === "staff" && trigger.type === type
}

function isProvider<T extends ProviderEventType>(
  trigger: FulfilmentTrigger,
  type: T,
): trigger is ProviderEvent & { type: T } {
  return trigger.source === "provider" && trigger.type === type
}

function isSystem<T extends SystemEventType>(
  trigger: FulfilmentTrigger,
  type: T,
): trigger is SystemEvent & { type: T } {
  return trigger.source === "system" && trigger.type === type
}
