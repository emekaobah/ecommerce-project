import { z } from "@medusajs/framework/zod"

/** The region whose popular searches the Search tab shows (#124). */
export const StoreGetPopularSearches = z.object({ region_id: z.string().min(1).max(64) })

export type StoreGetPopularSearchesType = z.infer<typeof StoreGetPopularSearches>
