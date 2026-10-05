import { MedusaError } from "@medusajs/framework/utils"
import { createStep } from "@medusajs/framework/workflows-sdk"
import { fulfilmentsOf } from "../../../lib/order-fulfilment"
import { pickListOf } from "../../../lib/order-picking"

/**
 * Refuses to pack an order being picked until every line is picked in full. An order in any
 * other state is left for the transition to refuse, with its own reason.
 */
export const checkPickedStep = createStep("check-order-picked", async ({ order_id }: { order_id: string }, { container }) => {
  const state = (await fulfilmentsOf(container, [order_id])).get(order_id)?.state
  if (state !== "picking") return
  const { lines, progress } = await pickListOf(container, order_id)
  if (progress.done) return
  const short = lines.filter((line) => progress.unpicked.includes(line.id))
  const names = short.map((line) => `${line.quantity - line.picked} × ${line.product_title ?? line.id}`).join(", ")
  throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Order ${order_id} can't be packed: still to pick ${names}`)
})
