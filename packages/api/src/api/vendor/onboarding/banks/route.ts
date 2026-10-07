import type { MedusaResponse } from "@medusajs/framework/http"
import { banksFor, currencyOf } from "../../../../lib/onboarding"
import { sellerOf, type VendorRequest } from "../../offer-import/seller"

/** The banks a shop can be paid into, in its currency, as Paystack lists them. */
export const GET = async (req: VendorRequest, res: MedusaResponse<{ banks: { code: string; name: string }[] }>) => {
  res.json({ banks: await banksFor(await currencyOf(req.scope, sellerOf(req))) })
}
