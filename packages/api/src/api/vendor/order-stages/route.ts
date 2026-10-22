import type { MedusaResponse } from "@medusajs/framework/http"
import { stageCounts, type StageCounts } from "../../../lib/order-stages"
import { sellerOf, type VendorRequest } from "../offer-import/seller"

export type VendorOrderStagesResponse = { counts: StageCounts }

/** How many of the shop's orders are New, Picking, Ready and Out (#69): the vendor app's stage tiles. */
export const GET = async (req: VendorRequest, res: MedusaResponse<VendorOrderStagesResponse>) => {
  res.json({ counts: await stageCounts(req.scope, sellerOf(req)) })
}
