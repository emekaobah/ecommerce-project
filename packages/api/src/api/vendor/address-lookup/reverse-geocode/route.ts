import type { MedusaResponse } from "@medusajs/framework/http"
import type { LookedUpPlace } from "@oja/domain"
import { addressAt } from "../../../../lib/address-lookup"
import { sellerOf, type VendorRequest } from "../../offer-import/seller"
import type { VendorReverseGeocodeType } from "../validators"

export type VendorReverseGeocodeResponse = { place: LookedUpPlace | null }

/** The address at the shop owner's location; null outside the countries the shop trades in. */
export const GET = async (req: VendorRequest<unknown, VendorReverseGeocodeType>, res: MedusaResponse<VendorReverseGeocodeResponse>) => {
  const { latitude, longitude } = req.validatedQuery
  const place = await addressAt(req.scope, { sellerId: sellerOf(req), latitude, longitude })
  res.json({ place })
}
