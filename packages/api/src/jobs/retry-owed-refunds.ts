import type { MedusaContainer } from "@medusajs/framework/types"
import { paystackClient } from "../modules/paystack"
import { retryOwedRefunds } from "../lib/refund-retry"

/** Retries the refunds orders owe their buyers, with backoff, and hands those it can't make to Oja's team (#16). */
export default async function retryOwedRefundsJob(container: MedusaContainer) {
  if (!paystackClient()) return
  await retryOwedRefunds(container)
}

export const config = { name: "retry-owed-refunds", schedule: "*/5 * * * *" }
