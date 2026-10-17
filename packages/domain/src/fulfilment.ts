/**
 * The order fulfilment state machine shared by the backend and the vendor app
 * (docs/design.md, "Order state machine").
 *
 * A seller order's fulfilment method (delivery or pickup) is fixed when the
 * order is placed. Both share the start, then each has its own path:
 *
 *   new → accepted → picking → ┬─ delivery: packed → label_booked → courier_confirmed
 *                              │      → handed_to_courier → in_transit → delivered
 *                              └─ pickup:   ready_for_pickup → collected
 *
 * Branches: new → rejected (seller declines, or the 24h accept deadline
 * passes); picking ⇄ partially_available → packed (or ready_for_pickup);
 * label_booked or courier_confirmed → packed when the shipment provider
 * cancels (rebook); handed_to_courier → delivered when the provider never
 * reported transit; ready_for_pickup → not_collected when the pickup hold
 * expires (#32), which is final: no code is taken there.
 *
 * Every trigger names its source: a `staff` action (who and when), a
 * shipment-`provider` event, or a `system` event. Provider events are generic
 * (not tied to one courier aggregator), so a provider adapter maps its own
 * webhook statuses onto them. The types keep each path's triggers to its own
 * orders: no label or courier event on a pickup order, no code event on a
 * delivery order; `transition` refuses them at run time too.
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
 *
 * The courier may move on before staff tap (#25): a transit or delivery the
 * provider reports first counts as its pickup and is remembered in
 * `reported`, so the tap that completes the handover takes the order straight
 * to where the courier says it is, rather than leaving it stuck.
 */
export type HandoverProgress = { staff?: StaffHandover; pickup?: ProviderPickup; reported?: ProviderProgress[] }
/** A state past handover the provider reported, and when (ISO 8601). */
export type ProviderProgress = { state: "in_transit" | "delivered"; at: string }
/** A completed handover, carried forward so later states keep who handed over and when. */
export type Handover = { staff: StaffHandover; pickup: ProviderPickup }

/**
 * A pickup order handed over at the counter (#12): the member who checked the
 * code, when (ISO 8601), and the name the collector gave.
 */
export type Collection = { actor: string; at: string; collectedBy: string }

/** How a seller order reaches its buyer; fixed when the order is placed. */
export type FulfilmentMethod = "delivery" | "pickup"

/** The states both methods share, before the paths part. */
type SharedState =
  | { state: "new" }
  | { state: "accepted" }
  | { state: "rejected"; rejectedBy: "seller" | "accept_deadline" }
  | { state: "picking" }
  | { state: "partially_available" }

export type DeliveryFulfilment = { method: "delivery" } & (
  | SharedState
  | { state: "packed" }
  | { state: "label_booked" }
  | { state: "courier_confirmed"; handover: HandoverProgress }
  | { state: "handed_to_courier"; handover: Handover }
  | { state: "in_transit"; handover: Handover }
  | { state: "delivered"; handover: Handover }
)

export type PickupFulfilment = { method: "pickup" } & (
  | SharedState
  | { state: "ready_for_pickup" }
  | { state: "collected"; collection: Collection }
  | { state: "not_collected" }
)

export type Fulfilment = DeliveryFulfilment | PickupFulfilment

export type FulfilmentState = Fulfilment["state"]

/** Staff actions either method takes. */
export type SharedStaffActionType =
  | "accept"
  | "reject"
  | "start_picking"
  | "mark_partially_available"
  | "resume_picking"
  | "mark_packed"

export type StaffActionType = SharedStaffActionType | "confirm_handover" | "collect"

/** Events any shipment provider reports, whatever its own status names. */
export type ProviderEventType =
  | "label_created"
  | "confirmed"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "cancelled"

export type SystemEventType = "accept_deadline_passed" | "pickup_hold_expired"

/** An action taken by seller staff in the app; `actor` is the member id. */
export type StaffAction<T extends Exclude<StaffActionType, "collect"> = Exclude<StaffActionType, "collect">> = {
  source: "staff"
  type: T
  actor: string
  at: string
}
/** Staff hand a pickup order over once its code checks out, naming who collected it. */
export type CollectAction = { source: "staff"; type: "collect"; actor: string; at: string; collectedBy: string }
/** An event reported by the shipment provider. */
export type ProviderEvent = { source: "provider"; type: ProviderEventType; at: string }
/** An event raised by the platform itself, such as a scheduled job. */
export type SystemEvent = { source: "system"; type: SystemEventType; at: string }

/** What can happen to a delivery order: never a pickup code. */
export type DeliveryTrigger = StaffAction<SharedStaffActionType | "confirm_handover"> | ProviderEvent | SystemEvent
/** What can happen to a pickup order: never a label or a courier. */
export type PickupTrigger = StaffAction<SharedStaffActionType> | CollectAction | SystemEvent

export type FulfilmentTrigger = DeliveryTrigger | PickupTrigger

/** The triggers a fulfilment's method takes. */
export type TriggerFor<F extends Fulfilment> = F extends { method: "pickup" } ? PickupTrigger : DeliveryTrigger

export type TransitionError = {
  code: "forbidden_transition"
  from: FulfilmentState
  trigger: Pick<FulfilmentTrigger, "source" | "type">
}

export type TransitionResult = { ok: true; fulfilment: Fulfilment } | { ok: false; error: TransitionError }

/** The fulfilment of an order that has just been placed, to go by `method`. */
export function newFulfilment<M extends FulfilmentMethod>(method: M): Extract<Fulfilment, { method: M; state: "new" }> {
  return { method, state: "new" } as Extract<Fulfilment, { method: M; state: "new" }>
}

/** Applies a trigger to a fulfilment, or explains why it is not allowed. */
export function transition<F extends Fulfilment>(fulfilment: F, trigger: TriggerFor<F>): TransitionResult {
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
  new: ({ method }, trigger) => {
    if (isStaff(trigger, "accept")) return { method, state: "accepted" }
    if (isStaff(trigger, "reject")) return { method, state: "rejected", rejectedBy: "seller" }
    if (isSystem(trigger, "accept_deadline_passed")) {
      return { method, state: "rejected", rejectedBy: "accept_deadline" }
    }
    return undefined
  },
  accepted: ({ method }, trigger) => (isStaff(trigger, "start_picking") ? { method, state: "picking" } : undefined),
  picking: ({ method }, trigger) => {
    if (isStaff(trigger, "mark_packed")) return packed(method)
    if (isStaff(trigger, "mark_partially_available")) return { method, state: "partially_available" }
    return undefined
  },
  partially_available: ({ method }, trigger) => {
    if (isStaff(trigger, "resume_picking")) return { method, state: "picking" }
    if (isStaff(trigger, "mark_packed")) return packed(method)
    return undefined
  },
  packed: (_, trigger) => (isProvider(trigger, "label_created") ? { method: "delivery", state: "label_booked" } : undefined),
  label_booked: (_, trigger) => {
    if (isProvider(trigger, "confirmed")) return { method: "delivery", state: "courier_confirmed", handover: {} }
    if (isProvider(trigger, "cancelled")) return { method: "delivery", state: "packed" }
    // The courier moving the parcel means it confirmed, though that webhook came late or not at
    // all: the order is confirmed and the event counts as it would there.
    if (isProvider(trigger, "picked_up") || isProvider(trigger, "in_transit") || isProvider(trigger, "delivered")) {
      return STEPS.courier_confirmed({ method: "delivery", state: "courier_confirmed", handover: {} }, trigger)
    }
    return undefined
  },
  courier_confirmed: ({ handover }, trigger) => {
    if (isProvider(trigger, "cancelled")) return { method: "delivery", state: "packed" }
    if (isStaff(trigger, "confirm_handover") && !handover.staff) {
      return recordHandover({ ...handover, staff: { actor: trigger.actor, at: trigger.at } })
    }
    if (isProvider(trigger, "picked_up") && !handover.pickup) {
      return recordHandover({ ...handover, pickup: { at: trigger.at } })
    }
    if (isProvider(trigger, "in_transit") || isProvider(trigger, "delivered")) {
      const reached = handover.reported ?? []
      // Each once, and never back from delivered to in transit.
      if (reached.some((r) => r.state === trigger.type || r.state === "delivered")) return undefined
      return recordHandover({
        ...handover,
        pickup: handover.pickup ?? { at: trigger.at },
        reported: [...reached, { state: trigger.type, at: trigger.at }],
      })
    }
    return undefined
  },
  handed_to_courier: ({ handover }, trigger) => {
    if (isProvider(trigger, "in_transit")) return { method: "delivery", state: "in_transit", handover }
    // A missed transit webhook doesn't hold up delivery.
    if (isProvider(trigger, "delivered")) return { method: "delivery", state: "delivered", handover }
    return undefined
  },
  in_transit: ({ handover }, trigger) =>
    isProvider(trigger, "delivered") ? { method: "delivery", state: "delivered", handover } : undefined,
  ready_for_pickup: (_, trigger) => {
    if (isSystem(trigger, "pickup_hold_expired")) return { method: "pickup", state: "not_collected" }
    if (trigger.source !== "staff" || trigger.type !== "collect") return undefined
    const { actor, at, collectedBy } = trigger
    return { method: "pickup", state: "collected", collection: { actor, at, collectedBy } }
  },
  rejected: done,
  delivered: done,
  collected: done,
  not_collected: done,
}

/** Packing ends picking: a delivery order waits for its label, a pickup order is ready at the counter. */
const packed = (method: FulfilmentMethod): Fulfilment =>
  method === "pickup" ? { method, state: "ready_for_pickup" } : { method, state: "packed" }

function nextFulfilment(fulfilment: Fulfilment, trigger: FulfilmentTrigger): Fulfilment | undefined {
  // The mapped type pairs each state with its own step; TypeScript can't correlate the union here.
  const step = STEPS[fulfilment.state] as Step<FulfilmentState>
  return step(fulfilment, trigger)
}

/** Completes the handover once both halves are in, at the furthest state the provider reported. */
function recordHandover(handover: HandoverProgress): Fulfilment {
  const { staff, pickup, reported } = handover
  if (!staff || !pickup) return { method: "delivery", state: "courier_confirmed", handover }
  const furthest = reported?.at(-1)?.state ?? "handed_to_courier"
  return { method: "delivery", state: furthest, handover: { staff, pickup } }
}

function isStaff<T extends Exclude<StaffActionType, "collect">>(
  trigger: FulfilmentTrigger,
  type: T,
): trigger is StaffAction<T> {
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
