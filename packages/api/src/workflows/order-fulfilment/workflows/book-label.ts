import { emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { Modules } from "@medusajs/framework/utils"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { createOrderFulfillmentWorkflow } from "@mercurjs/core/workflows"
import type { LabelBooking } from "../../../lib/label-booking"
import { ORDER_LABEL_BOOKED, type Shipment } from "../../../lib/order-fulfilment"
import { SHIPBUBBLE_RATE, type ShipbubbleFulfillmentData } from "../../../modules/shipbubble"
import { checkTransitionStep, transitionFulfilmentStep } from "../steps/transition-fulfilment"
import { lockOrderFulfilment, providerTrigger } from "../compose"

/** `booking`: the rate to book and what it is booked instead of (`decideLabel`, `approvedBooking`). */
export type BookLabelInput = { order_id: string; booking: LabelBooking; /** The member, or operator, who booked it. */ actor: string }

/** The shipment Shipbubble booked on the fulfilment, as the order keeps it, with the courier the buyer chose and the difference (#19). */
const bookedShipmentStep = createStep(
  "booked-order-shipment",
  async ({ fulfillment_id, booking }: { fulfillment_id: string; booking: LabelBooking }, { container }) => {
    const fulfillment = await container.resolve(Modules.FULFILLMENT).retrieveFulfillment(fulfillment_id)
    const data = fulfillment.data as unknown as ShipbubbleFulfillmentData
    const { request_token: _bookedBy, delivery_eta_time, ...courier } = booking.rate
    const shipment: Shipment = {
      waybill: data.shipment_id,
      tracking_url: data.tracking_url,
      fulfillment_id,
      booked_at: new Date().toISOString(),
      cancelled_at: null,
      courier,
      delivery_eta_time,
      chosen: booking.chosen,
      difference: courier.amount - booking.chosen.amount,
    }
    return new StepResponse(shipment)
  }
)

/**
 * Books a courier label for a packed order (#24): Packed → Label booked, with the rate staff
 * booked (`decideLabel`) or Oja's team approved (`approvedBooking`), quoted moments before. The
 * label is booked on a Medusa fulfilment of the order's lines, paid from the platform's
 * Shipbubble wallet (`ShipbubbleFulfillmentProviderService.createFulfillment`). The waybill and
 * tracking link are kept on the fulfilment's label and on the order's fulfilment row, with the
 * courier the buyer chose and what the booked one costs above it (#19). Also rebooks an order
 * whose shipment Shipbubble cancelled. If anything after the booking fails, the fulfilment is
 * cancelled, which cancels the shipment with Shipbubble.
 */
export const bookLabelWorkflow = createWorkflow("book-order-label", (input: BookLabelInput) => {
  // Held through the booking, up to the Shipbubble client's timeout, so a second tap can't book
  // and pay for a second label.
  const lock = lockOrderFulfilment(input, 60)
  // Shipbubble created the label; who asked for it is the fulfilment's `created_by`.
  const trigger = providerTrigger(input, () => "label_created" as const)
  checkTransitionStep({ order_id: input.order_id, trigger })
  const fulfillmentInput = transform({ input }, ({ input }) => ({
    input: {
      order_id: input.order_id,
      created_by: input.actor,
      items: input.booking.items,
      metadata: { [SHIPBUBBLE_RATE]: input.booking.rate },
    },
  }))
  const fulfillment = createOrderFulfillmentWorkflow.runAsStep(fulfillmentInput)
  const shipment = bookedShipmentStep({ fulfillment_id: fulfillment.id, booking: input.booking })
  const fulfilment = transitionFulfilmentStep({ order_id: input.order_id, trigger, shipment })
  emitEventStep({ eventName: ORDER_LABEL_BOOKED, data: { id: input.order_id } })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
