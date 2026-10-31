import { z } from "@medusajs/framework/zod"

/** A search the buyer used (#124). */
export const StoreRecordSearch = z.object({
  /** As the buyer typed it; recorded normalised. */
  term: z.string().trim().min(1).max(200),
  /** Recorded only when the region exists. */
  region_id: z.string().min(1).max(64),
  /** The phone's own random id, never the buyer's: one phone counts once towards a popular search. */
  phone_id: z.string().uuid(),
})

export type StoreRecordSearchType = z.infer<typeof StoreRecordSearch>
