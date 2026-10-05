import type { MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { banksFor } from "../../../../lib/onboarding"
import { sellerOf, type VendorRequest } from "../../offer-import/seller"

/** The banks a shop can be paid into, in its currency, as Paystack lists them. */
export const GET = async (req: VendorRequest, res: MedusaResponse<{ banks: { code: string; name: string }[] }>) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "seller", fields: ["currency_code"], filters: { id: sellerOf(req) } })
  res.json({ banks: await banksFor((data[0] as { currency_code: string }).currency_code) })
}
