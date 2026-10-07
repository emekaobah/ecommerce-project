import type { MedusaResponse } from "@medusajs/framework/http"
import type { LookedUpPlace } from "@oja/domain"
import { placeAddress } from "../../../../../lib/address-lookup"
import { sellerOf, type VendorRequest } from "../../../offer-import/seller"
import type { VendorGetPlaceAddressType } from "../../validators"

export type VendorPlaceAddressResponse = { place: LookedUpPlace }

/** A suggested place's address, to fill the pickup address form and open the pin map at. */
export const GET = async (req: VendorRequest<unknown, VendorGetPlaceAddressType>, res: MedusaResponse<VendorPlaceAddressResponse>) => {
  const { session_token } = req.validatedQuery
  const place = await placeAddress(req.scope, {
    sellerId: sellerOf(req),
    placeId: req.params.place_id,
    sessionToken: session_token,
  })
  res.json({ place })
}
