import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { LookedUpPlace } from "@oja/domain"
import { placeAddress } from "../../../../../lib/address-lookup"
import type { StoreGetPlaceAddressType } from "../../validators"

export type StorePlaceAddressResponse = { place: LookedUpPlace }

/** A suggested place's address, to fill the form and open the pin map at. */
export const GET = async (
  req: AuthenticatedMedusaRequest<unknown, StoreGetPlaceAddressType>,
  res: MedusaResponse<StorePlaceAddressResponse>
) => {
  const { cart_id, session_token } = req.validatedQuery as StoreGetPlaceAddressType
  const place = await placeAddress(req.scope, {
    cartId: cart_id,
    customerId: req.auth_context.actor_id,
    placeId: req.params.place_id,
    sessionToken: session_token,
  })
  res.json({ place })
}
