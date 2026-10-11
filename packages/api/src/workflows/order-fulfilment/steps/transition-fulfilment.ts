import { randomInt } from "node:crypto"
import { newFulfilment, PICKUP_CODE_LENGTH, recordReached, transition, type Fulfilment, type FulfilmentTrigger } from "@oja/domain"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import {
  asFulfilmentRecord,
  fulfilmentService,
  fulfilmentsOf,
  ORDER_STATE_CHANGED,
  placedOrderOf,
  type FulfilmentRecord,
  type Shipment,
} from "../../../lib/order-fulfilment"

export type TransitionFulfilmentInput = {
  order_id: string
  trigger: FulfilmentTrigger
  /** Kept on the order when the trigger rejects it. */
  reject_reason?: string
  /** The courier shipment the order now has, when the trigger books or cancels one. */
  shipment?: Shipment
}

type Compensation = { created?: string; previous?: FulfilmentRecord }

/** The order's next fulfilment by the trigger, or a refusal of a trigger its state doesn't allow. */
function nextFulfilment(orderId: string, from: Fulfilment, trigger: FulfilmentTrigger) {
  const result = transition(from, trigger)
  if (!result.ok) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Order ${orderId} is a ${from.method} order ${result.error.from.replaceAll("_", " ")}: it can't be ${trigger.type.replaceAll("_", " ")}`
    )
  }
  return result.fulfilment
}

/** Where the order is, and when it was placed: an order without a row yet is New, by the method it was placed with. */
async function currentFulfilment(container: Parameters<typeof fulfilmentService>[0], orderId: string) {
  const previous = (await fulfilmentsOf(container, [orderId])).get(orderId)
  if (previous) return { previous, from: previous.fulfilment, placedAt: previous.placed_at }
  const placed = await placedOrderOf(container, orderId)
  if (!placed) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order with id: ${orderId} was not found`)
  const { placed_at, method } = placed
  return { previous, from: newFulfilment(method) as Fulfilment, placedAt: placed_at }
}

/** A new pickup code: random digits, never derived from the order. */
const pickupCode = () => String(randomInt(0, 10 ** PICKUP_CODE_LENGTH)).padStart(PICKUP_CODE_LENGTH, "0")

/**
 * Refuses a trigger the order's state doesn't allow, before a workflow does anything it would
 * have to undo (such as booking a label). The transition itself still checks again.
 */
export const checkTransitionStep = createStep(
  "check-order-fulfilment-transition",
  async ({ order_id, trigger }: Pick<TransitionFulfilmentInput, "order_id" | "trigger">, { container }) => {
    nextFulfilment(order_id, (await currentFulfilment(container, order_id)).from, trigger)
    return new StepResponse(undefined)
  }
)

/**
 * Moves the order's fulfilment on by the trigger, or refuses a trigger its state doesn't allow.
 * Records when the order reached its new state (#25). An order reaching Delivered or Collected,
 * by whichever trigger, may now be paid out; a shipment cancelled back to Packed may be alerted
 * about again; a pickup order Ready for pickup is issued its code (#12). A new state emits
 * `order_fulfilment.state_changed` once the workflow succeeds.
 */
export const transitionFulfilmentStep = createStep(
  "transition-order-fulfilment",
  async ({ order_id, trigger, reject_reason, shipment }: TransitionFulfilmentInput, { container, eventGroupId }) => {
    const service = fulfilmentService(container)
    const { previous, from, placedAt } = await currentFulfilment(container, order_id)
    const fulfilment = nextFulfilment(order_id, from, trigger)
    const reached = recordReached(previous?.reached ?? {}, from, fulfilment, trigger.at)
    const next = {
      state: fulfilment.state,
      fulfilment,
      reached,
      ...(fulfilment.state === "rejected" && { reject_reason: reject_reason ?? null }),
      ...(shipment && { shipment, shipment_id: shipment.waybill }),
      // Nothing leaves Delivered or Collected, so this is the transition that reached it.
      ...(fulfilment.state === "delivered" && { payout_eligible_at: new Date(reached.delivered ?? trigger.at) }),
      ...(fulfilment.state === "collected" && { payout_eligible_at: new Date(reached.collected ?? trigger.at) }),
      ...(fulfilment.state === "packed" && { handover_alerted_at: null }),
      ...(fulfilment.state === "ready_for_pickup" && { pickup_code: pickupCode(), pickup_code_attempts: [] }),
    }
    const saved = previous
      ? await service.updateOrderFulfilments({ id: previous.id, ...next })
      : await service.createOrderFulfilments({ order_id, placed_at: placedAt, ...next })
    if (fulfilment.state !== from.state) {
      // Grouped with the workflow's other events: released only if it succeeds, cleared if not.
      await container.resolve(Modules.EVENT_BUS).emit({
        name: ORDER_STATE_CHANGED,
        data: { id: order_id, state: fulfilment.state },
        metadata: { eventGroupId },
      })
    }
    return new StepResponse(asFulfilmentRecord(saved), previous ? { previous } : { created: saved.id })
  },
  async (compensation: Compensation | undefined, { container }) => {
    if (!compensation) return
    const service = fulfilmentService(container)
    if (compensation.created) await service.deleteOrderFulfilments(compensation.created)
    const { previous } = compensation
    if (previous) {
      await service.updateOrderFulfilments({
        id: previous.id,
        state: previous.state,
        fulfilment: previous.fulfilment,
        reject_reason: previous.reject_reason,
        shipment: previous.shipment,
        shipment_id: previous.shipment_id,
        reached: previous.reached,
        payout_eligible_at: previous.payout_eligible_at,
        handover_alerted_at: previous.handover_alerted_at,
        pickup_code: previous.pickup_code,
        pickup_code_attempts: previous.pickup_code_attempts,
      })
    }
  }
)
