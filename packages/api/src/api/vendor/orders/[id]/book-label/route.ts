import type { MedusaResponse } from "@medusajs/framework/http"
import { bookOrderLabel } from "../../../../../lib/courier-choice"
import type { CourierOption } from "../../../../../lib/label-booking"
import { fulfilmentResponse, type OrderFulfilmentResponse } from "../../../../fulfilment-response"
import { shopsOwnOrder, type VendorRequest } from "../../fulfilment"
import type { VendorBookLabelType } from "../../validators"

/**
 * The order's fulfilment after booking, and the couriers staff choose from when the one booking
 * picked costs the platform more than the top-up cap above the buyer's checkout price (#19).
 */
export type BookLabelResponse = OrderFulfilmentResponse & { courier_options: CourierOption[] | null }

/**
 * Staff book a courier label for a packed order (Packed → Label booked), paid from the
 * platform's Shipbubble wallet; or rebook one whose shipment Shipbubble cancelled. Refused for
 * an order that isn't packed. Without `courier`, the buyer's courier is booked, or the nearest
 * to it (`rateToBook`), unless it costs more than the cap above what the buyer paid: then
 * nothing is booked and `courier_options` lists the couriers quoting now. With `courier`, that
 * one is booked when within the cap, and otherwise waits for Oja's team to approve it
 * (`fulfilment.courier_approval`).
 */
export const POST = async (req: VendorRequest<VendorBookLabelType>, res: MedusaResponse<BookLabelResponse>) => {
  const orderId = await shopsOwnOrder(req)
  const { fulfilment, courier_options } = await bookOrderLabel(req.scope, {
    order_id: orderId,
    actor: req.auth_context.actor_id,
    courier: req.validatedBody.courier,
  })
  res.json({ ...fulfilmentResponse(fulfilment), courier_options })
}
