import type { MedusaResponse } from "@medusajs/framework/http"
import { resumeShop, vendorShopHours } from "../../../../lib/shop-hours"
import { noticeShopsOpeningAndClosing } from "../../../../lib/vendor-live-activity"
import { errorMessage } from "../../../../lib/errors"
import { sellerOf, type VendorRequest } from "../../offer-import/seller"
import type { VendorShopHoursResponse } from "../route"

/**
 * Takes orders again now; answers the shop's hours. With orders waiting, its Live Activity starts
 * again now; the minute job catches it if this can't.
 */
export const POST = async (req: VendorRequest, res: MedusaResponse<VendorShopHoursResponse>) => {
  const sellerId = sellerOf(req)
  await resumeShop(req.scope, sellerId)
  await noticeShopsOpeningAndClosing(req.scope, new Date(), sellerId).catch((error) => req.scope.resolve("logger").warn(`Restarting shop ${sellerId}'s Live Activity failed: ${errorMessage(error)}`))
  res.json({ shop_hours: await vendorShopHours(req.scope, sellerId) })
}
