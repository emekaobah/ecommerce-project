import { z } from "@medusajs/framework/zod"

/** The top-up cap (#19): a flat amount per shipment, in the store's currency. */
export const AdminSetTopUpCap = z.object({ top_up_cap: z.number().int().min(0) })
export type AdminSetTopUpCapType = z.infer<typeof AdminSetTopUpCap>
