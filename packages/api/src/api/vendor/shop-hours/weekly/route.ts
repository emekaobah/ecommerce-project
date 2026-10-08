import type { MedusaResponse } from "@medusajs/framework/http"
import { setWeeklyHours, vendorShopHours } from "../../../../lib/shop-hours"
import { sellerOf, type VendorRequest } from "../../offer-import/seller"
import type { VendorShopHoursResponse } from "../route"
import type { VendorSetWeeklyHoursType } from "../validators"

/** Sets the shop's weekly opening hours, in its region's timezone; answers its hours. */
export const POST = async (req: VendorRequest<VendorSetWeeklyHoursType>, res: MedusaResponse<VendorShopHoursResponse>) => {
  const sellerId = sellerOf(req)
  await setWeeklyHours(req.scope, sellerId, req.validatedBody.weekly)
  res.json({ shop_hours: await vendorShopHours(req.scope, sellerId) })
}
