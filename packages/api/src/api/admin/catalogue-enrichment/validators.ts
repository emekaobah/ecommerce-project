import { z } from "@medusajs/framework/zod"

export const AdminListEnrichments = z.object({
  outcome: z.enum(["published", "needs_review", "incomplete"]).optional(),
  status: z.enum(["queued", "done", "failed"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export type AdminListEnrichmentsType = z.infer<typeof AdminListEnrichments>
