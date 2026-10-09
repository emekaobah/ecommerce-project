import { newFulfilment, recordReached, transition, type FulfilmentTrigger } from "@oja/domain"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import {
  asFulfilmentRecord,
  fulfilmentService,
  fulfilmentsOf,
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
function nextFulfilment(orderId: string, previous: FulfilmentRecord | undefined, trigger: FulfilmentTrigger) {
  const result = transition(previous?.fulfilment ?? { state: "new" }, trigger)
  if (!result.ok) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Order ${orderId} is ${result.error.from.replaceAll("_", " ")}: it can't be ${trigger.type.replaceAll("_", " ")}`
    )
  }
  return result.fulfilment
}

/**
 * Refuses a trigger the order's state doesn't allow, before a workflow does anything it would
 * have to undo (such as booking a label). The transition itself still checks again.
 */
export const checkTransitionStep = createStep(
  "check-order-fulfilment-transition",
  async ({ order_id, trigger }: Pick<TransitionFulfilmentInput, "order_id" | "trigger">, { container }) => {
    nextFulfilment(order_id, (await fulfilmentsOf(container, [order_id])).get(order_id), trigger)
    return new StepResponse(undefined)
  }
)

/**
 * Moves the order's fulfilment on by the trigger, or refuses a trigger its state doesn't allow.
 * Records when the order reached its new state (#25). An order reaching Delivered, by whichever
 * trigger, may now be paid out; a shipment cancelled back to Packed may be alerted about again.
 */
export const transitionFulfilmentStep = createStep(
  "transition-order-fulfilment",
  async ({ order_id, trigger, reject_reason, shipment }: TransitionFulfilmentInput, { container }) => {
    const service = fulfilmentService(container)
    const previous = (await fulfilmentsOf(container, [order_id])).get(order_id)
    const placedAt = previous?.placed_at ?? (await placedAtOf(container, order_id))
    const fulfilment = nextFulfilment(order_id, previous, trigger)
    const from = previous?.fulfilment ?? newFulfilment()
    const reached = recordReached(previous?.reached ?? {}, from, fulfilment, trigger.at)
    const next = {
      state: fulfilment.state,
      fulfilment,
      reached,
      ...(fulfilment.state === "rejected" && { reject_reason: reject_reason ?? null }),
      ...(shipment && { shipment, shipment_id: shipment.waybill }),
      // Nothing leaves Delivered, so this is the transition that reached it.
      ...(fulfilment.state === "delivered" && { payout_eligible_at: new Date(reached.delivered ?? trigger.at) }),
      ...(fulfilment.state === "packed" && { handover_alerted_at: null }),
    }
    const saved = previous
      ? await service.updateOrderFulfilments({ id: previous.id, ...next })
      : await service.createOrderFulfilments({ order_id, placed_at: placedAt, ...next })
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
      })
    }
  }
)

async function placedAtOf(container: Parameters<typeof fulfilmentService>[0], orderId: string): Promise<Date> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order", fields: ["created_at"], filters: { id: orderId } })
  if (!data[0]) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order with id: ${orderId} was not found`)
  return new Date(data[0].created_at as string | Date)
}
