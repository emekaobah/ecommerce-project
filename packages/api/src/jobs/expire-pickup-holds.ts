import type { MedusaContainer } from "@medusajs/framework/types"
import { expirePickupHolds } from "../lib/pickup-hold"

/** Moves pickup orders whose hold has ended to Not collected, refunding their non-perishable lines (#32). */
export default async function expirePickupHoldsJob(container: MedusaContainer) {
  await expirePickupHolds(container)
}

export const config = { name: "expire-pickup-holds", schedule: "*/5 * * * *" }
