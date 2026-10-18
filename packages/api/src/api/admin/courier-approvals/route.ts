import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { courierApprovals, type AdminCourierApproval } from "../../../lib/courier-choice"
import { topUpCap } from "../../../lib/label-booking"

export type AdminCourierApprovalsResponse = { courier_approvals: AdminCourierApproval[]; top_up_cap: number }

/**
 * The couriers shops chose above the top-up cap, waiting for Oja's team to approve them (#19),
 * longest waiting first, and the cap itself: the most the platform pays above a buyer's
 * checkout price for a shipment without approving it. The admin's Courier approvals page.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse<AdminCourierApprovalsResponse>) {
  const [courier_approvals, top_up_cap] = await Promise.all([courierApprovals(req.scope), topUpCap(req.scope)])
  res.json({ courier_approvals, top_up_cap })
}
