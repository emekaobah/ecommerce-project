import type { MedusaResponse } from "@medusajs/framework/http"
import { shopsOwnOrder, type VendorRequest } from "../../fulfilment"

export type VendorOrderCommissionLinesResponse = { commission_lines: never[]; count: 0 }

/**
 * Replaces Mercur's route at this path, so the shop's order page shows one commission (#23, ADR 0009).
 * Mercur's commission lines are worked out when the order is placed and don't follow a refund made
 * without an order edit, so beside our payout (`GET /vendor/orders/:id/payout`) they showed a second,
 * stale figure. Mercur's order page shows its Commission row only when this returns a line, so it
 * returns none; the payout's commission is the one the shop is charged. Another shop's order is a 404,
 * as with Mercur's.
 */
export const GET = async (req: VendorRequest, res: MedusaResponse<VendorOrderCommissionLinesResponse>) => {
  await shopsOwnOrder(req)
  res.json({ commission_lines: [], count: 0 })
}
