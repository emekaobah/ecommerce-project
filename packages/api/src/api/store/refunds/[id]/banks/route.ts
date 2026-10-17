import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { refundBanks } from "../../../../../lib/refund-accounts"

/** The banks the buyer can have their refund sent to, in its currency (#13). */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse<{ banks: { code: string; name: string }[] }>) => {
  const banks = await refundBanks(req.scope, req.auth_context.actor_id, req.params.id)
  res.json({ banks })
}
