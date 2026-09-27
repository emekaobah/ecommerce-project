import { z } from "@medusajs/framework/zod"
import type { EnrichmentOutcome, EnrichmentStatus } from "../../../lib/enrichment"

const OUTCOMES = ["published", "needs_review", "incomplete"] as const satisfies readonly EnrichmentOutcome[]
const STATUSES = ["queued", "done", "failed"] as const satisfies readonly EnrichmentStatus[]

export const AdminListEnrichments = z.object({
  outcome: z.enum(OUTCOMES).optional(),
  status: z.enum(STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export type AdminListEnrichmentsType = z.infer<typeof AdminListEnrichments>
