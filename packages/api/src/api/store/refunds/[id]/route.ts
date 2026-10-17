import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buyerRefundAccountView, type BuyerRefundAccount } from "../../../../lib/refund-accounts"

/** A refund of one of the buyer's orders, and whether it needs their bank account (#13). */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse<{ refund: BuyerRefundAccount }>) => {
  const refund = await buyerRefundAccountView(req.scope, req.auth_context.actor_id, req.params.id)
  res.json({ refund })
}
