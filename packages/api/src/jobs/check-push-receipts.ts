import type { MedusaContainer } from "@medusajs/framework/types"
import { checkPushReceipts } from "../lib/push-receipts"

/** Forgets devices whose push receipts say the app is no longer installed (#27). */
export default async function checkPushReceiptsJob(container: MedusaContainer) {
  await checkPushReceipts(container)
}

// Hourly: each run checks the pushes of the hour before (`checkPushReceipts`).
export const config = { name: "check-push-receipts", schedule: "0 * * * *" }
