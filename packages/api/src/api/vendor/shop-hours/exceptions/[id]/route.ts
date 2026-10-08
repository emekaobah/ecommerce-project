import type { MedusaResponse } from "@medusajs/framework/http"
import { removeHoursException, vendorShopHours } from "../../../../../lib/shop-hours"
import { sellerOf, type VendorRequest } from "../../../offer-import/seller"
import type { VendorShopHoursResponse } from "../../route"

/** Removes one of the shop's exceptions; answers its hours. */
export const DELETE = async (req: VendorRequest, res: MedusaResponse<VendorShopHoursResponse>) => {
  const sellerId = sellerOf(req)
  await removeHoursException(req.scope, sellerId, req.params.id)
  res.json({ shop_hours: await vendorShopHours(req.scope, sellerId) })
}
