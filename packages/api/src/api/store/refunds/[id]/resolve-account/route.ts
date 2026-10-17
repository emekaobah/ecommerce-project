import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resolveRefundAccount } from "../../../../../lib/refund-accounts"
import type { StoreRefundAccountType } from "../../validators"

/**
 * The holder's name of the bank account the buyer entered, for them to confirm before their
 * refund is sent to it (#13). A POST, so the account number is never in a URL or access log.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<StoreRefundAccountType>,
  res: MedusaResponse<{ account: { bank_name: string; account_name: string } }>
) => {
  const account = await resolveRefundAccount(req.scope, req.auth_context.actor_id, req.params.id, req.validatedBody)
  res.json({ account })
}
