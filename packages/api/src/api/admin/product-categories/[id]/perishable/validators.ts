import { z } from "@medusajs/framework/zod"

export const AdminSetCategoryPerishable = z.object({ perishable: z.boolean() })
export type AdminSetCategoryPerishableType = z.infer<typeof AdminSetCategoryPerishable>
