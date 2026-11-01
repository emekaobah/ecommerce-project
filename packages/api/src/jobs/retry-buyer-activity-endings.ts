import type { MedusaContainer } from "@medusajs/framework/types"
import { retryBuyerActivityEndings } from "../lib/buyer-live-activity"

/** Each minute: tries again the buyer activity endings Apple couldn't take (#133). */
export default async function retryBuyerActivityEndingsJob(container: MedusaContainer) {
  await retryBuyerActivityEndings(container)
}

export const config = { name: "retry-buyer-activity-endings", schedule: "* * * * *" }
