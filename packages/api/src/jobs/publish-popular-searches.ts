import type { MedusaContainer } from "@medusajs/framework/types"
import { publishPopularSearches } from "../lib/popular-searches"

/** Publishes each region's popular searches from the last 14 days, and forgets searches past 90 days (#124). */
export default async function publishPopularSearchesJob(container: MedusaContainer) {
  await publishPopularSearches(container)
}

export const config = { name: "publish-popular-searches", schedule: "0 * * * *" }
