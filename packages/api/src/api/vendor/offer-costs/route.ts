import { MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { loadOfferCosts, type OfferCostView } from "../../../lib/offer-import"
import { sellerOf, type VendorRequest } from "../offer-import/seller"
import type { VendorGetOfferCostsType } from "../offer-import/validators"

/**
 * The shop's private cost on its offers, and whether each sells below it. Only
 * members who may price offers (owners and managers) reach this route; see the
 * policy in middlewares.ts.
 */
export async function GET(req: VendorRequest, res: MedusaResponse<{ offer_costs: OfferCostView[] }>) {
  const { offer_id, product_id } = req.validatedQuery as VendorGetOfferCostsType
  const sellerId = sellerOf(req)
  let ids = offer_id === undefined ? undefined : [offer_id].flat()
  if (product_id !== undefined) {
    const { data } = await req.scope.resolve(ContainerRegistrationKeys.QUERY).graph({
      entity: "offer",
      fields: ["id"],
      filters: { seller_id: sellerId, product_id },
    })
    const onProduct = (data as { id: string }[]).map((o) => o.id)
    ids = ids ? ids.filter((id) => onProduct.includes(id)) : onProduct
  }
  res.json({ offer_costs: ids?.length === 0 ? [] : await loadOfferCosts(req.scope, sellerId, ids) })
}
