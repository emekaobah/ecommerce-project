import type { MedusaContainer } from "@medusajs/framework/types"
import { flagUnmatchedRefunds, previousDay } from "../lib/refund-check"

/**
 * Flags yesterday's Paystack refunds that no order refund records, such as one made by hand (#29).
 * Runs before the payout job, so a flagged refund is seen before the order is paid out.
 */
export default async function checkPaystackRefundsJob(container: MedusaContainer) {
  await flagUnmatchedRefunds(container, previousDay())
}

export const config = { name: "check-paystack-refunds", schedule: "30 0 * * *" }
