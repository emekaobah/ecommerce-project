import type { MedusaResponse } from "@medusajs/framework/http"
import { vendorShopHours, type VendorShopHours } from "../../../lib/shop-hours"
import { sellerOf, type VendorRequest } from "../offer-import/seller"

export type VendorShopHoursResponse = { shop_hours: VendorShopHours }

/** The shop's weekly hours, coming exceptions, pause, what buyers see now, and how many orders wait (ADR 0004). */
export const GET = async (req: VendorRequest, res: MedusaResponse<VendorShopHoursResponse>) => {
  res.json({ shop_hours: await vendorShopHours(req.scope, sellerOf(req)) })
}
