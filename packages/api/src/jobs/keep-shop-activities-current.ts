import type { MedusaContainer } from "@medusajs/framework/types"
import { endActivitiesOfClosedShops } from "../lib/vendor-live-activity"

/** Ends shops' Live Activities when they close; nothing else says a shop's hours have passed (#146). */
export default async function endClosedShopActivitiesJob(container: MedusaContainer) {
  await endActivitiesOfClosedShops(container)
}

export const config = { name: "end-closed-shop-activities", schedule: "* * * * *" }
