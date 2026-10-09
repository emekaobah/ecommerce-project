import type { MedusaContainer } from "@medusajs/framework/types"
import { flagUnmatchedRefunds, previousDay } from "../lib/refund-check"

/** Flags yesterday's Paystack refunds that no order refund records, such as one made by hand (#29). */
export default async function checkPaystackRefundsJob(container: MedusaContainer) {
  await flagUnmatchedRefunds(container, previousDay())
}

export const config = { name: "check-paystack-refunds", schedule: "0 2 * * *" }
