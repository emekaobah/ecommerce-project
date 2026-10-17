import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { retryRefundToAccount, type BuyerRefundAccount } from "../../../../../lib/refund-accounts"
import type { StoreRefundAccountType } from "../../validators"

/** Retries the buyer's refund to the bank account they confirmed (#13). */
export const POST = async (req: AuthenticatedMedusaRequest<StoreRefundAccountType>, res: MedusaResponse<{ refund: BuyerRefundAccount }>) => {
  const refund = await retryRefundToAccount(req.scope, req.auth_context.actor_id, req.params.id, req.validatedBody)
  res.json({ refund })
}
