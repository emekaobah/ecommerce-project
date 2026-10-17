import type { z } from "@medusajs/framework/zod"
import { cancelOrderBody } from "../../../../cancel-order"

/** Why Oja's operators cancel an accepted order (#17): the reasons its shop gives too (`cancelOrderBody`). */
export const AdminCancelOrder = cancelOrderBody
export type AdminCancelOrderType = z.infer<typeof AdminCancelOrder>
