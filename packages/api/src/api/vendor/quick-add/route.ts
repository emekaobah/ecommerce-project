import type { MedusaResponse } from "@medusajs/framework/http"
import { quickAdd, type QuickAddResult } from "../../../lib/quick-add"
import { sellerOf, type VendorRequest } from "../offer-import/seller"
import type { VendorQuickAddType } from "./validators"

/**
 * Adds a scanned product the shop doesn't sell yet (#38): an offer on the catalogue's
 * product, or a proposal with the member's photo, offered once approved. The offer
 * records the member who added it. Refused for a product the shop already sells.
 */
export async function POST(req: VendorRequest<VendorQuickAddType>, res: MedusaResponse<QuickAddResult>) {
  const result = await quickAdd(
    req.scope,
    { seller_id: sellerOf(req), member_id: req.auth_context.actor_id },
    req.validatedBody
  )
  res.status(201).json(result)
}
