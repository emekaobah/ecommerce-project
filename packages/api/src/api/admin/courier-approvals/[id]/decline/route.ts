import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { declineCourier } from "../../../../../lib/courier-choice"
import { fulfilmentResponse, type OrderFulfilmentResponse } from "../../../../fulfilment-response"

/** Oja's team decline the courier waiting on the order (`:id`) (#19): it stays packed, for the shop to choose again. */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse<OrderFulfilmentResponse>) {
  res.json(fulfilmentResponse(await declineCourier(req.scope, req.params.id)))
}
