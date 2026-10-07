import type { MedusaContainer } from "@medusajs/framework/types"
import { remindAcceptDeadlines } from "../lib/order-acceptance"

/** Reminds shops, once each, of new orders nearing their accept deadline (#27). */
export default async function remindAcceptDeadlinesJob(container: MedusaContainer) {
  await remindAcceptDeadlines(container)
}

export const config = { name: "remind-accept-deadlines", schedule: "*/5 * * * *" }
