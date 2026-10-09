import type { MedusaResponse } from "@medusajs/framework/http"
import { orderPayoutView, type OrderPayoutView } from "../../../../../lib/payouts"
import { shopsOwnOrder, type VendorRequest } from "../../fulfilment"

export type VendorOrderPayoutResponse = { payout: OrderPayoutView }

/**
 * What the shop is paid for its order (#29): what the buyer kept, the delivery fee Oja keeps,
 * the 10% commission, and where the payout is. Once paid out, what it was paid out with,
 * including what it took back for refunds after earlier payouts.
 */
export const GET = async (req: VendorRequest, res: MedusaResponse<VendorOrderPayoutResponse>) => {
  const orderId = await shopsOwnOrder(req)
  res.json({ payout: await orderPayoutView(req.scope, orderId) })
}
