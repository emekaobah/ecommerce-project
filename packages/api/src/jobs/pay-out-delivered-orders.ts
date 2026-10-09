import type { MedusaContainer } from "@medusajs/framework/types"
import { payOutDeliveredOrders } from "../lib/pay-out-orders"
import { paystackClient } from "../modules/paystack"

/** Pays shops for their delivered orders with Paystack Transfers, daily (#29). */
export default async function payOutDeliveredOrdersJob(container: MedusaContainer) {
  // Without Paystack, Mercur's system provider would mark payouts paid without paying anyone.
  if (!paystackClient()) return
  await payOutDeliveredOrders(container)
}

export const config = { name: "pay-out-delivered-orders", schedule: "0 1 * * *" }
