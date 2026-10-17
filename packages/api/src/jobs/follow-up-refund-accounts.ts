import type { MedusaContainer } from "@medusajs/framework/types"
import { followUpRefundAccounts } from "../lib/refund-accounts"

/** Reminds buyers of refunds waiting for their bank account, and hands those 7 days old to Oja's team (#13). */
export default async function followUpRefundAccountsJob(container: MedusaContainer) {
  await followUpRefundAccounts(container)
}

export const config = { name: "follow-up-refund-accounts", schedule: "0 * * * *" }
