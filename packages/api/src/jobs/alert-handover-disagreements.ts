import type { MedusaContainer } from "@medusajs/framework/types"
import { alertHandoverDisagreements } from "../lib/handover"

/** Alerts owners, once each, of handovers where staff and the courier disagree for too long (#25). */
export default async function alertHandoverDisagreementsJob(container: MedusaContainer) {
  await alertHandoverDisagreements(container)
}

export const config = { name: "alert-handover-disagreements", schedule: "*/15 * * * *" }
