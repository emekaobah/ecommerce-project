import type { MedusaContainer } from "@medusajs/framework/types"
import { rejectOverdueOrders } from "../lib/order-acceptance"

/** Rejects and refunds new orders not accepted by their deadline (#20). */
export default async function rejectOverdueOrdersJob(container: MedusaContainer) {
  await rejectOverdueOrders(container)
}

export const config = { name: "reject-overdue-orders", schedule: "*/5 * * * *" }
