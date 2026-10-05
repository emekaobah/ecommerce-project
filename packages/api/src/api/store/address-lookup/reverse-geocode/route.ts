import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { LookedUpPlace } from "@oja/domain"
import { addressAt } from "../../../../lib/address-lookup"
import type { StoreReverseGeocodeType } from "../validators"

export type StoreReverseGeocodeResponse = { place: LookedUpPlace | null }

/** The address at the buyer's current location; null where the region doesn't deliver. */
export const GET = async (
  req: AuthenticatedMedusaRequest<unknown, StoreReverseGeocodeType>,
  res: MedusaResponse<StoreReverseGeocodeResponse>
) => {
  const { cart_id, region_id, latitude, longitude } = req.validatedQuery as StoreReverseGeocodeType
  const place = await addressAt(req.scope, {
    cartId: cart_id,
    regionId: region_id,
    customerId: req.auth_context.actor_id,
    latitude,
    longitude,
  })
  res.json({ place })
}
