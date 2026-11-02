import type { MedusaContainer } from "@medusajs/framework/types"
import { keepShopActivitiesCurrent } from "../lib/vendor-live-activity"

/**
 * Each minute: ends the Live Activities of shops that closed, starts them for shops that opened
 * with orders waiting, and sends the batch of count and deadline changes (#146, #147).
 */
export default async function keepShopActivitiesCurrentJob(container: MedusaContainer) {
  await keepShopActivitiesCurrent(container)
}

export const config = { name: "keep-shop-activities-current", schedule: "* * * * *" }
