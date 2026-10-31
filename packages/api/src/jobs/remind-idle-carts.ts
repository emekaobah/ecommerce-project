import type { MedusaContainer } from "@medusajs/framework/types"
import { remindIdleCarts } from "../lib/cart-reminders"

/** Reminds signed-in buyers of the carts they left unpaid (#134), once per change of their items, in the day's sending hours. */
export default async function remindIdleCartsJob(container: MedusaContainer) {
  await remindIdleCarts(container)
}

export const config = { name: "remind-idle-carts", schedule: "0 * * * *" }
