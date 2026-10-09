import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { orderOfShipment } from "../../../lib/order-fulfilment"
import {
  shipmentCancelledWorkflow,
  shipmentUpdateWorkflow,
  type ShipmentUpdateInput,
} from "../../../workflows/order-fulfilment/workflows/shipment-updates"

/** The shipment event each of Shipbubble's statuses reports, other than `cancelled`. */
const EVENT_OF_STATUS: Record<string, ShipmentUpdateInput["event"]> = {
  pending: "label_created",
  confirmed: "confirmed",
  picked_up: "picked_up",
  in_transit: "in_transit",
  completed: "delivered",
}

/** A Shipbubble webhook about a shipment (the fields we use). */
type ShipmentWebhook = { event?: string; order_id?: string; status?: string }

/**
 * Shipbubble's webhooks (#24), signed in `x-ship-signature` (checked first, see
 * `api/middlewares.ts`). A shipment's status moves the order whose current shipment it is:
 * `shipment.label.created` or `pending` → Label booked, `confirmed` → Courier confirmed, `cancelled` →
 * back to Packed for staff to rebook; `picked_up` is the courier's half of the handover, then
 * `in_transit` → In transit and `completed` → Delivered (#25). Statuses the order's state doesn't
 * take now (repeats, late retries, a shipment since rebooked, or one that isn't ours) are
 * acknowledged and ignored, so Shipbubble stops retrying them; anything else failing is answered
 * with an error, so Shipbubble retries.
 */
export const POST = async (req: MedusaRequest<ShipmentWebhook>, res: MedusaResponse) => {
  const { event, order_id: shipmentId } = req.body ?? {}
  // A label-created event means Label booked whatever status it carries.
  const status = event === "shipment.label.created" ? "pending" : req.body?.status
  const record = shipmentId ? await orderOfShipment(req.scope, shipmentId) : undefined
  const update = status ? EVENT_OF_STATUS[status] : undefined
  if (!shipmentId || !record || (!update && status !== "cancelled")) {
    res.json({ received: true })
    return
  }
  const input = { order_id: record.order_id, shipment_id: shipmentId }
  try {
    if (update) await shipmentUpdateWorkflow(req.scope).run({ input: { ...input, event: update } })
    else await shipmentCancelledWorkflow(req.scope).run({ input })
  } catch (error) {
    // A workflow's errors come back as plain objects carrying the MedusaError's type.
    const { type, message } = (error ?? {}) as { type?: string; message?: string }
    if (type !== MedusaError.Types.NOT_ALLOWED) throw error
    req.scope.resolve(ContainerRegistrationKeys.LOGGER).info(`Shipbubble webhook for ${shipmentId} (${status}) ignored: ${message}`)
  }
  res.json({ received: true })
}
