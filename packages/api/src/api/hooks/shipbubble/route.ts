import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { orderOfShipment } from "../../../lib/order-fulfilment"
import { shipmentCancelledWorkflow, shipmentUpdateWorkflow } from "../../../workflows/order-fulfilment/workflows/shipment-updates"

/** A Shipbubble webhook about a shipment (the fields we use). */
type ShipmentWebhook = { event?: string; order_id?: string; status?: string }

/**
 * Shipbubble's webhooks (#24), signed in `x-ship-signature` (checked first, see
 * `api/middlewares.ts`). A shipment's status moves the order whose current shipment it is:
 * `pending` (label created) → Label booked, `confirmed` → Courier confirmed, `cancelled` →
 * back to Packed for staff to rebook. Statuses the order's state doesn't take now (repeats,
 * late retries, a shipment since rebooked, or one that isn't ours) are acknowledged and
 * ignored, so Shipbubble stops retrying them; anything else failing is answered with an error,
 * so Shipbubble retries. Later statuses (picked up, in transit, completed) belong to #25.
 */
export const POST = async (req: MedusaRequest<ShipmentWebhook>, res: MedusaResponse) => {
  const { order_id: shipmentId, status } = req.body ?? {}
  const record = shipmentId ? await orderOfShipment(req.scope, shipmentId) : undefined
  if (!shipmentId || !record || !status) {
    res.json({ received: true })
    return
  }
  const input = { order_id: record.order_id, shipment_id: shipmentId }
  try {
    if (status === "cancelled") await shipmentCancelledWorkflow(req.scope).run({ input })
    else if (status === "pending") await shipmentUpdateWorkflow(req.scope).run({ input: { ...input, event: "label_created" } })
    else if (status === "confirmed") await shipmentUpdateWorkflow(req.scope).run({ input: { ...input, event: "confirmed" } })
  } catch (error) {
    // A workflow's errors come back as plain objects carrying the MedusaError's type.
    const { type, message } = (error ?? {}) as { type?: string; message?: string }
    if (type !== MedusaError.Types.NOT_ALLOWED) throw error
    req.scope.resolve(ContainerRegistrationKeys.LOGGER).info(`Shipbubble webhook for ${shipmentId} (${status}) ignored: ${message}`)
  }
  res.json({ received: true })
}
