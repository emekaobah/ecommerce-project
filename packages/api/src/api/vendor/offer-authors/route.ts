import type { MedusaResponse } from "@medusajs/framework/http"
import { loadOfferAuthors, type OfferAuthor } from "../../../lib/quick-add"
import { sellerOf, type VendorRequest } from "../offer-import/seller"
import type { VendorGetOfferAuthorsType } from "../quick-add/validators"

/**
 * Who added each of the shop's offers on a product, and whether by quick-add (#38),
 * for the panel's offer page, which is the product's.
 */
export async function GET(req: VendorRequest, res: MedusaResponse<{ offer_authors: OfferAuthor[] }>) {
  const { product_id } = req.validatedQuery as VendorGetOfferAuthorsType
  res.json({ offer_authors: await loadOfferAuthors(req.scope, sellerOf(req), product_id) })
}
