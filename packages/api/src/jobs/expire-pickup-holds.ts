import type { MedusaContainer } from "@medusajs/framework/types"
import { expireUncollectedOrders } from "../lib/pickup-hold"

/** Moves pickup orders nobody collected within their hold to Not collected, refunding what isn't perishable (#32). */
export default async function expirePickupHoldsJob(container: MedusaContainer) {
  await expireUncollectedOrders(container)
}

export const config = { name: "expire-pickup-holds", schedule: "*/5 * * * *" }
