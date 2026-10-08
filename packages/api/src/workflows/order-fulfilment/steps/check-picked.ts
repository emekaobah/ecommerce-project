import { MedusaError } from "@medusajs/framework/utils"
import { createStep } from "@medusajs/framework/workflows-sdk"
import { fulfilmentsOf } from "../../../lib/order-fulfilment"
import { pickListOf } from "../../../lib/order-picking"

/** The states an order can be packed from (`@oja/domain`'s `transition`). */
const PACKABLE = new Set(["picking", "partially_available"])

/**
 * Refuses to pack an order until every line is picked in full, and units marked unavailable
 * are removed from it (#22). An order in a state it can't be
 * packed from is left for the transition to refuse, with its own reason.
 */
export const checkPickedStep = createStep("check-order-picked", async ({ order_id }: { order_id: string }, { container }) => {
  const state = (await fulfilmentsOf(container, [order_id])).get(order_id)?.state
  if (!state || !PACKABLE.has(state)) return
  const { lines, progress } = await pickListOf(container, order_id)
  if (progress.done) return
  if (progress.unavailable > 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Order ${order_id} can't be packed: remove the ${progress.unavailable} unavailable from the order first`
    )
  }
  const short = lines.filter((line) => progress.unpicked.includes(line.id))
  const names = short.map((line) => `${line.quantity - line.picked} × ${line.product_title ?? line.id}`).join(", ")
  throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Order ${order_id} can't be packed: still to pick ${names}`)
})
