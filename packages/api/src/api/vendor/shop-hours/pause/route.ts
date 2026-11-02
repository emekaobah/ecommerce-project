import type { MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { pauseShop, vendorShopHours } from "../../../../lib/shop-hours"
import { endShopActivity, noticeShopsOpeningAndClosing } from "../../../../lib/vendor-live-activity"
import { errorMessage } from "../../../../lib/errors"
import { sellerOf, type VendorRequest } from "../../offer-import/seller"
import type { VendorShopHoursResponse } from "../route"
import type { VendorPauseShopType } from "../validators"

/**
 * Stops taking orders now, until resumed or `until` (ADR 0004). Orders already accepted carry
 * on; New ones must still be accepted by their deadline, which the pause doesn't move (#18).
 * Its Live Activity ends now; the job that ends closed shops' tries again if this can't.
 * Answers the shop's hours.
 */
export const POST = async (req: VendorRequest<VendorPauseShopType>, res: MedusaResponse<VendorShopHoursResponse>) => {
  const sellerId = sellerOf(req)
  await pauseShop(req.scope, sellerId, req.validatedBody)
  await Promise.all([endShopActivity(req.scope, sellerId), noticeShopsOpeningAndClosing(req.scope, new Date(), sellerId)]).catch((error) => req.scope.resolve(ContainerRegistrationKeys.LOGGER).warn(`Ending shop ${sellerId}'s Live Activity failed: ${errorMessage(error)}`))
  res.json({ shop_hours: await vendorShopHours(req.scope, sellerId) })
}
