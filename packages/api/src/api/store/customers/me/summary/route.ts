import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { accountSummary, type AccountSummary } from "../../../../../lib/account-summary"

/** The counts on the buyer's Account screen, in one request (#73). Medusa signs in `/store/customers/me*`. */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse<{ summary: AccountSummary }>) => {
  res.json({ summary: await accountSummary(req.scope, req.auth_context.actor_id) })
}
