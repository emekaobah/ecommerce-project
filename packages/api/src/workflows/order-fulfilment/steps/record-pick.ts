import { MedusaError } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { asFulfilmentRecord, fulfilmentService, type Picks } from "../../../lib/order-fulfilment"
import { lineBeingPicked } from "../../../lib/order-picking"

export type RecordPickInput = {
  order_id: string
  item_id: string
} & ({ /** How many of the line are now picked. */ picked: number } | { /** How many more are picked. */ add: number })

type Compensation = { id: string; picks: Picks | null }

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
