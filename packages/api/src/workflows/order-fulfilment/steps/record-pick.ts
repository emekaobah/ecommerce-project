import { MedusaError } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { asFulfilmentRecord, fulfilmentService, fulfilmentsOf, type Picks } from "../../../lib/order-fulfilment"
import { itemsOf } from "../../../lib/order-picking"

export type RecordPickInput = {
  order_id: string
  item_id: string
} & ({ /** How many of the line are now picked. */ picked: number } | { /** How many more are picked. */ add: number })

type Compensation = { id: string; picks: Picks | null }

/** The states staff pick in: picking, and partially available while units wait to be removed (#22). */
const PICKING = new Set(["picking", "partially_available"])

/** The order's fulfilment row and one of its lines, while the order is being picked; refuses any other. */
export async function lineBeingPicked(container: Parameters<typeof fulfilmentsOf>[0], orderId: string, itemId: string) {
  const record = (await fulfilmentsOf(container, [orderId])).get(orderId)
  const state = record?.state ?? "new"
  if (!record || !PICKING.has(state)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Order ${orderId} is ${state.replaceAll("_", " ")}: it isn't being picked`)
  }
  // A line removed in full is no longer on the order.
  const item = (await itemsOf(container, orderId)).find((i) => i.id === itemId && i.quantity > 0)
  if (!item) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${orderId} has no line ${itemId}`)
  return { record, item }
}

/**
 * Sets, or adds to, how many of one line staff have picked; only while the order is being
 * picked, and never past the units ordered less those marked unavailable.
 */
export const recordPickStep = createStep(
  "record-order-pick",
  async ({ order_id, item_id, ...pick }: RecordPickInput, { container }) => {
    const { record, item } = await lineBeingPicked(container, order_id, item_id)
    const picked = "add" in pick ? (record.picks?.[item_id] ?? 0) + pick.add : pick.picked
    const unavailable = record.unavailable?.[item_id] ?? 0
    if (picked + unavailable > item.quantity) {
      const what = unavailable ? `${item.quantity - unavailable} of line ${item_id} are available` : `${item.quantity} of line ${item_id} were ordered`
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `Only ${what}${"add" in pick ? ", and all are picked" : ""}`)
    }
    const saved = await fulfilmentService(container).updateOrderFulfilments({
      id: record.id,
      picks: { ...record.picks, [item_id]: picked },
    })
    return new StepResponse(asFulfilmentRecord(saved), { id: record.id, picks: record.picks })
  },
  async (compensation: Compensation | undefined, { container }) => {
    if (!compensation) return
    await fulfilmentService(container).updateOrderFulfilments(compensation)
  }
)
