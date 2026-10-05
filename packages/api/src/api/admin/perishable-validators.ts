import { z } from "@medusajs/framework/zod"

export const AdminSetCategoryPerishable = z.object({ perishable: z.boolean() })
export type AdminSetCategoryPerishableType = z.infer<typeof AdminSetCategoryPerishable>

/** True or false wins over the product's categories; null follows them again. */
export const AdminOverrideProductPerishable = z.object({ override: z.boolean().nullable() })
export type AdminOverrideProductPerishableType = z.infer<typeof AdminOverrideProductPerishable>
