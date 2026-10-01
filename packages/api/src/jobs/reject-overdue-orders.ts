import type { MedusaContainer } from "@medusajs/framework/types"
import { refundUnclaimedPayments, rejectOverdueOrders } from "../lib/order-acceptance"

/**
 * Rejects and refunds new orders not accepted by their deadline, and refunds payments no
 * order claims (#20).
 */
export default async function rejectOverdueOrdersJob(container: MedusaContainer) {
  await rejectOverdueOrders(container)
  await refundUnclaimedPayments(container)
}

export const config = { name: "reject-overdue-orders", schedule: "*/5 * * * *" }
