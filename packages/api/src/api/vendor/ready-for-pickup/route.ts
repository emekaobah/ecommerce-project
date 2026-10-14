import type { MedusaResponse } from "@medusajs/framework/http"
import { readyForPickup } from "../../../lib/order-fulfilment"
import { sellerOf, type VendorRequest } from "../offer-import/seller"

export type VendorReadyForPickupResponse = { order_ids: string[] }

/**
 * The shop's orders waiting at the counter for their buyers (#12), longest waiting first: the
 * vendor app's ready-for-pickup list, however old they are. The app reads the orders themselves
 * from `/vendor/orders` by these ids.
 */
export const GET = async (req: VendorRequest, res: MedusaResponse<VendorReadyForPickupResponse>) => {
  res.json({ order_ids: await readyForPickup(req.scope, sellerOf(req)) })
}
