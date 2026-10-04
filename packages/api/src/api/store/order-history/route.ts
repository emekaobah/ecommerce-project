import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listBuyerOrderGroups, type BuyerOrderGroup } from "../../../lib/buyer-orders"
import type { StoreGetOrderHistoryType } from "./validators"

/** The buyer's order groups, newest first, each with its shops' orders. */
export const GET = async (
  req: AuthenticatedMedusaRequest<unknown, StoreGetOrderHistoryType>,
  res: MedusaResponse<{ order_groups: BuyerOrderGroup[]; count: number; limit: number; offset: number }>
) => {
  const { limit, offset } = req.validatedQuery
  const { order_groups, count } = await listBuyerOrderGroups(req.scope, req.auth_context.actor_id, { limit, offset })
  res.json({ order_groups, count, limit, offset })
}
