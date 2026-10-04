import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { retrieveBuyerOrderGroup, type BuyerOrderGroup } from "../../../../lib/buyer-orders"

/** One of the buyer's order groups, with each shop's order of it. */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse<{ order_group: BuyerOrderGroup }>) => {
  const order_group = await retrieveBuyerOrderGroup(req.scope, req.auth_context.actor_id, req.params.id)
  res.json({ order_group })
}
