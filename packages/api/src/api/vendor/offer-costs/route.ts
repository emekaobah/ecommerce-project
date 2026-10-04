import { MedusaResponse } from "@medusajs/framework/http"
import { loadOfferCosts, type OfferCostView } from "../../../lib/offer-import"
import { sellerOf, type VendorRequest } from "../offer-import/seller"
import type { VendorGetOfferCostsType } from "../offer-import/validators"

/**
 * The shop's private cost on its offers, and whether each sells below it. Only
 * members who may price offers (owners and managers) reach this route; see the
 * policy in middlewares.ts.
 */
export async function GET(req: VendorRequest, res: MedusaResponse<{ offer_costs: OfferCostView[] }>) {
  const { offer_id } = req.validatedQuery as VendorGetOfferCostsType
  const ids = offer_id === undefined ? undefined : [offer_id].flat()
  res.json({ offer_costs: await loadOfferCosts(req.scope, sellerOf(req), ids) })
}
