import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

type VendorRequest = MedusaRequest & { seller_context?: { seller_id: string } }
type PriceListPrice = { variant_id?: string; rules?: Record<string, unknown> }
type PriceListBody = { prices?: PriceListPrice[]; create?: PriceListPrice[]; update?: PriceListPrice[] }

/**
 * Offers of a variant share its price set and are told apart by an `offer_id` price rule, so a
 * shop's sale price without one would lower every shop's offer of the variant (#10). A price-list
 * price a shop writes must name one of its own offers, of the price's variant; anything else is
 * refused (400) before it is saved. The vendor panel always sends the rule; operators' price lists
 * go through the admin routes and are unaffected.
 */
export async function salePricesOnOwnOffersOnly(req: VendorRequest, _res: MedusaResponse, next: MedusaNextFunction) {
  const body = (req.body ?? {}) as PriceListBody
  const prices = [...(body.prices ?? []), ...(body.create ?? []), ...(body.update ?? [])]
  if (!prices.length) return next()

  const offerIds = prices.map((p) => p.rules?.offer_id)
  if (offerIds.some((id) => typeof id !== "string")) {
    return next(refusal("Every sale price must be for one of the shop's own offers (an offer_id rule)."))
  }
  const sellerId = req.seller_context?.seller_id
  if (!sellerId) return next(new MedusaError(MedusaError.Types.UNAUTHORIZED, "No shop to price the offers of"))
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: offers } = await query.graph({
    entity: "offer",
    fields: ["id", "variant_id"],
    filters: { id: [...new Set(offerIds as string[])], seller_id: sellerId },
  })
  const variantOf = new Map((offers as unknown as { id: string; variant_id: string }[]).map((o) => [o.id, o.variant_id]))
  if (prices.some((p) => variantOf.get(p.rules!.offer_id as string) !== p.variant_id)) {
    return next(refusal("A sale price can only be for one of the shop's own offers, of the same variant."))
  }
  next()
}

const refusal = (message: string) => new MedusaError(MedusaError.Types.INVALID_DATA, message)
