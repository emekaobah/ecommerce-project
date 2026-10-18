import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { approveCourier } from "../../../../../lib/courier-choice"
import { fulfilmentResponse, type OrderFulfilmentResponse } from "../../../../fulfilment-response"

/**
 * Oja's team approve the courier waiting on the order (`:id`) (#19): it is quoted again and its
 * label booked at its price now, paid from the platform's wallet. Refused when it no longer
 * quotes; 404 when no courier is waiting.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse<OrderFulfilmentResponse>) {
  res.json(fulfilmentResponse(await approveCourier(req.scope, { order_id: req.params.id, actor: req.auth_context.actor_id })))
}
