import { emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { cancelOrderFulfillmentWorkflow } from "@mercurjs/core/workflows"
import { fulfilmentsOf, ORDER_PICKUP_SCHEDULED, ORDER_SHIPMENT_CANCELLED, type Shipment } from "../../../lib/order-fulfilment"
import { cancelledByShipbubble } from "../../../modules/shipbubble"
import { checkOrderLiveStep } from "../steps/check-order-live"
import { transitionFulfilmentStep } from "../steps/transition-fulfilment"
import { lockOrderFulfilment, providerTrigger, whenDelivered } from "../compose"

// Shipbubble's webhooks about an order's shipment (#24), once the route has checked the signature.

type ShipmentInput = { order_id: string; /** Shipbubble's id for the shipment, its waybill. */ shipment_id: string }

/**
 * The order's shipment, if the webhook is about it: the shipment booked last and not cancelled.
 * Anything else (a shipment since cancelled and rebooked) is refused as not allowed.
 */
const currentShipmentStep = createStep("current-order-shipment", async ({ order_id, shipment_id }: ShipmentInput, { container }) => {
  const record = (await fulfilmentsOf(container, [order_id])).get(order_id)
  const shipment = record?.shipment
  if (!shipment || record.shipment_id !== shipment_id || shipment.cancelled_at) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Shipment ${shipment_id} is no longer order ${order_id}'s`)
  }
  return new StepResponse(shipment)
})

export type ShipmentUpdateInput = ShipmentInput & {
  event: "label_created" | "confirmed" | "picked_up" | "in_transit" | "delivered"
}

/**
 * Shipbubble reports the label created (Label booked, which booking has normally done
 * already), the courier confirmed (Label booked → Courier confirmed, and the shop is pushed
 * that the pickup is scheduled), the parcel picked up (its half of the handover, #25), in
 * transit, or delivered (payout-eligible). Transit or delivery reported before the handover is
 * complete is kept for when it is. Nothing moves an order cancelled meanwhile.
 */
export const shipmentUpdateWorkflow = createWorkflow("order-shipment-update", (input: ShipmentUpdateInput) => {
  const lock = lockOrderFulfilment(input)
  currentShipmentStep(input)
  checkOrderLiveStep({ order_id: input.order_id })
  const trigger = providerTrigger(input, (input) => input.event)
  const fulfilment = transitionFulfilmentStep({ order_id: input.order_id, trigger })
  when({ input }, ({ input }) => input.event === "confirmed").then(() => {
    emitEventStep({ eventName: ORDER_PICKUP_SCHEDULED, data: { id: input.order_id } }).config({ name: "emit-pickup-scheduled" })
  })
  whenDelivered(fulfilment)
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})

/** The fulfilment's data before it was marked; `data` is undefined when nothing was marked. */
type MarkCompensation = { fulfillment_id: string; data?: Record<string, unknown> | null }

/**
 * Marks the fulfilment's shipment cancelled by Shipbubble, so cancelling the fulfilment
 * doesn't ask Shipbubble to cancel it again. Says whether the fulfilment is still to cancel:
 * one cancelled already is left as it is.
 */
const markCancelledByShipbubbleStep = createStep(
  "mark-shipment-cancelled-by-shipbubble",
  async ({ fulfillment_id }: { fulfillment_id: string }, { container }) => {
    const service = container.resolve(Modules.FULFILLMENT)
    const { data, canceled_at } = await service.retrieveFulfillment(fulfillment_id)
    const live = !canceled_at
    if (live) await service.updateFulfillment(fulfillment_id, { data: cancelledByShipbubble(data ?? {}) })
    const compensation: MarkCompensation = live ? { fulfillment_id, data } : { fulfillment_id }
    return new StepResponse({ live }, compensation)
  },
  async (previous, { container }) => {
    if (previous?.data === undefined) return
    await container.resolve(Modules.FULFILLMENT).updateFulfillment(previous.fulfillment_id, { data: previous.data ?? {} })
  }
)

/**
 * Shipbubble cancelled the order's shipment: Label booked or Courier confirmed → Packed, for
 * staff to rebook. The shipment is kept, marked cancelled, and its fulfilment is cancelled,
 * which returns its items' reservations for the next.
 */
export const shipmentCancelledWorkflow = createWorkflow("order-shipment-cancelled", (input: ShipmentInput) => {
  const lock = lockOrderFulfilment(input)
  const current = currentShipmentStep(input)
  const shipment = transform({ current }, ({ current }): Shipment => ({ ...current, cancelled_at: new Date().toISOString() }))
  const trigger = providerTrigger(input, () => "cancelled" as const)
  const fulfilment = transitionFulfilmentStep({ order_id: input.order_id, trigger, shipment })
  const marked = markCancelledByShipbubbleStep({ fulfillment_id: current.fulfillment_id })
  when({ marked }, ({ marked }) => marked.live).then(() => {
    const cancel = transform({ input, current }, ({ input, current }) => ({
      input: { order_id: input.order_id, fulfillment_id: current.fulfillment_id, no_notification: true },
    }))
    cancelOrderFulfillmentWorkflow.runAsStep(cancel)
  })
  emitEventStep({ eventName: ORDER_SHIPMENT_CANCELLED, data: { id: input.order_id } })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
