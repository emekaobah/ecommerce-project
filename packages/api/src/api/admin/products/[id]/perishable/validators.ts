import { z } from "@medusajs/framework/zod"

/** True or false wins over the product's categories; null follows them again. */
export const AdminOverrideProductPerishable = z.object({ override: z.boolean().nullable() })
export type AdminOverrideProductPerishableType = z.infer<typeof AdminOverrideProductPerishable>
