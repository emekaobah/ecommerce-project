import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listOwedRefunds, type AdminOwedRefund } from "../../../lib/refund-retry"

export type AdminOwedRefundsResponse = { owed_refunds: AdminOwedRefund[] }

/**
 * The refunds orders owe their buyers and haven't made (#16): Paystack refused them, or they
 * are under its minimum. The admin's Owed refunds list, to retry one or mark it settled.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse<AdminOwedRefundsResponse>) {
  res.json({ owed_refunds: await listOwedRefunds(req.scope) })
}
