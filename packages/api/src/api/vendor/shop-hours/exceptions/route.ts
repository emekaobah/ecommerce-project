import type { MedusaResponse } from "@medusajs/framework/http"
import { addHoursException, vendorShopHours } from "../../../../lib/shop-hours"
import { sellerOf, type VendorRequest } from "../../offer-import/seller"
import type { VendorShopHoursResponse } from "../route"
import type { VendorCreateHoursExceptionType } from "../validators"

/** Adds days the shop is closed, or open with special hours; answers its hours. */
export const POST = async (
  req: VendorRequest<VendorCreateHoursExceptionType>,
  res: MedusaResponse<VendorShopHoursResponse>
) => {
  const sellerId = sellerOf(req)
  await addHoursException(req.scope, sellerId, req.validatedBody)
  res.json({ shop_hours: await vendorShopHours(req.scope, sellerId) })
}
