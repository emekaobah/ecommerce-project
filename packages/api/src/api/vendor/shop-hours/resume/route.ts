import type { MedusaResponse } from "@medusajs/framework/http"
import { resumeShop, vendorShopHours } from "../../../../lib/shop-hours"
import { sellerOf, type VendorRequest } from "../../offer-import/seller"
import type { VendorShopHoursResponse } from "../route"

/** Takes orders again now; answers the shop's hours. */
export const POST = async (req: VendorRequest, res: MedusaResponse<VendorShopHoursResponse>) => {
  const sellerId = sellerOf(req)
  await resumeShop(req.scope, sellerId)
  res.json({ shop_hours: await vendorShopHours(req.scope, sellerId) })
}
