import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listBuyerOrderGroups, type BuyerOrderGroup } from "../../../lib/buyer-orders"
import type { StoreGetOrderHistoryType } from "./validators"

/**
 * The buyer's order groups, newest first, each with its shops' orders: those in progress or
 * past (`phase`), or with an item named like `q` (#54). Paged, except the checkouts in progress
 * listed without a search, which come whole.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest<unknown, StoreGetOrderHistoryType>,
  res: MedusaResponse<{ order_groups: BuyerOrderGroup[]; count: number; limit: number; offset: number }>
) => {
  const { phase, q, limit, offset } = req.validatedQuery
  // The checkouts in progress are listed whole; a search pages, whatever the phase.
  const page = phase === "in_progress" && !q ? null : { limit, offset }
  const { order_groups, count } = await listBuyerOrderGroups(req.scope, req.auth_context.actor_id, { phase, q }, page)
  res.json({ order_groups, count, limit: page?.limit ?? count, offset: page?.offset ?? 0 })
}
