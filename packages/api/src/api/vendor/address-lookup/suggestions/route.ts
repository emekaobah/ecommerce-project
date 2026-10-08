import type { MedusaResponse } from "@medusajs/framework/http"
import { suggestAddresses } from "../../../../lib/address-lookup"
import type { AddressSuggestion } from "../../../../modules/address-lookup"
import { sellerOf, type VendorRequest } from "../../offer-import/seller"
import type { VendorSuggestAddressesType } from "../validators"

export type VendorAddressSuggestionsResponse = { suggestions: AddressSuggestion[] }

/** Places matching what the shop owner typed, in the countries of the region the shop trades in. */
export const GET = async (req: VendorRequest<unknown, VendorSuggestAddressesType>, res: MedusaResponse<VendorAddressSuggestionsResponse>) => {
  const { session_token, input } = req.validatedQuery
  const suggestions = await suggestAddresses(req.scope, { sellerId: sellerOf(req), text: input, sessionToken: session_token })
  res.json({ suggestions })
}
