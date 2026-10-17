import type { MedusaContainer } from "@medusajs/framework/types"
import { remindPickupHolds } from "../lib/pickup-reminders"

/** Reminds buyers, while the shop is open, to collect pickup orders half-way through the hold and on its last day (#33). */
export default async function remindPickupHoldsJob(container: MedusaContainer) {
  await remindPickupHolds(container)
}

export const config = { name: "remind-pickup-holds", schedule: "*/5 * * * *" }
