import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { suggestAddresses } from "../../../../lib/address-lookup"
import type { AddressSuggestion } from "../../../../modules/address-lookup"
import type { StoreSuggestAddressesType } from "../validators"

export type StoreAddressSuggestionsResponse = { suggestions: AddressSuggestion[] }

/** Places matching what the buyer typed, in their cart region's countries. */
export const GET = async (
  req: AuthenticatedMedusaRequest<unknown, StoreSuggestAddressesType>,
  res: MedusaResponse<StoreAddressSuggestionsResponse>
) => {
  const { cart_id, session_token, input } = req.validatedQuery as StoreSuggestAddressesType
  const suggestions = await suggestAddresses(req.scope, {
    cartId: cart_id,
    customerId: req.auth_context.actor_id,
    text: input,
    sessionToken: session_token,
  })
  res.json({ suggestions })
}
