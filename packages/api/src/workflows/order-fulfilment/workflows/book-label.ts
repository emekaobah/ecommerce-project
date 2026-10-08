import { emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows"
import { Modules } from "@medusajs/framework/utils"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { createOrderFulfillmentWorkflow } from "@mercurjs/core/workflows"
import { labelBooking } from "../../../lib/label-booking"
import { ORDER_LABEL_BOOKED, type Shipment } from "../../../lib/order-fulfilment"
import { SHIPBUBBLE_RATE, type ShipbubbleFulfillmentData } from "../../../modules/shipbubble"
import { checkTransitionStep, transitionFulfilmentStep } from "../steps/transition-fulfilment"
import { lockOrderFulfilment, providerTrigger } from "../compose"

export type BookLabelInput = { order_id: string; /** The member who booked it. */ actor: string }

/** Quotes the order's parcel now, for the courier to book. */
const quoteLabelStep = createStep("quote-order-label", async ({ order_id }: { order_id: string }, { container }) => {
  return new StepResponse(await labelBooking(container, order_id))
})

/** The shipment Shipbubble booked on the fulfilment, as the order keeps it. */
const bookedShipmentStep = createStep(
  "booked-order-shipment",
  async ({ fulfillment_id }: { fulfillment_id: string }, { container }) => {
    const fulfillment = await container.resolve(Modules.FULFILLMENT).retrieveFulfillment(fulfillment_id)
    const data = fulfillment.data as unknown as ShipbubbleFulfillmentData
    const shipment: Shipment = {
      waybill: data.shipment_id,
      courier_name: data.courier_name,
      tracking_url: data.tracking_url,
      fulfillment_id,
      booked_at: new Date().toISOString(),
      cancelled_at: null,
    }
    return new StepResponse(shipment)
  }
)

/**
 * Staff book a courier label for a packed order (#24): Packed → Label booked. The parcel is
 * quoted afresh and the label booked on a Medusa fulfilment of the order's lines, paid from
 * the platform's Shipbubble wallet (`ShipbubbleFulfillmentProviderService.createFulfillment`).
 * The waybill and tracking link are kept on the fulfilment's label and on the order's
 * fulfilment row. Also rebooks an order whose shipment Shipbubble cancelled. If anything after
 * the booking fails, the fulfilment is cancelled, which cancels the shipment with Shipbubble.
 */
export const bookLabelWorkflow = createWorkflow("book-order-label", (input: BookLabelInput) => {
  // Held through two Shipbubble calls (the quote and the booking), each up to the client's timeout,
  // so a second tap can't book and pay for a second label.
  const lock = lockOrderFulfilment(input, 120)
  // Shipbubble created the label; who asked for it is the fulfilment's `created_by`.
  const trigger = providerTrigger(input, () => "label_created" as const)
  checkTransitionStep({ order_id: input.order_id, trigger })
  const booking = quoteLabelStep({ order_id: input.order_id })
  const fulfillmentInput = transform({ input, booking }, ({ input, booking }) => ({
    input: {
      order_id: input.order_id,
      created_by: input.actor,
      items: booking.items,
      metadata: { [SHIPBUBBLE_RATE]: booking.rate },
    },
  }))
  const fulfillment = createOrderFulfillmentWorkflow.runAsStep(fulfillmentInput)
  const shipment = bookedShipmentStep({ fulfillment_id: fulfillment.id })
  const fulfilment = transitionFulfilmentStep({ order_id: input.order_id, trigger, shipment })
  emitEventStep({ eventName: ORDER_LABEL_BOOKED, data: { id: input.order_id } })
  releaseLockStep({ key: lock })
  return new WorkflowResponse(fulfilment)
})
