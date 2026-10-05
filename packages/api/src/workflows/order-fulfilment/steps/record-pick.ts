import { MedusaError } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { asFulfilmentRecord, fulfilmentService, fulfilmentsOf, type Picks } from "../../../lib/order-fulfilment"
import { itemsOf } from "../../../lib/order-picking"

export type RecordPickInput = {
  order_id: string
  item_id: string
} & ({ /** How many of the line are now picked. */ picked: number } | { /** How many more are picked. */ add: number })

type Compensation = { id: string; picks: Picks | null }

/** Sets, or adds to, how many of one line staff have picked; only while the order is being picked. */
export const recordPickStep = createStep(
  "record-order-pick",
  async ({ order_id, item_id, ...pick }: RecordPickInput, { container }) => {
    const record = (await fulfilmentsOf(container, [order_id])).get(order_id)
    const state = record?.state ?? "new"
    if (!record || state !== "picking") {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Order ${order_id} is ${state.replaceAll("_", " ")}: it isn't being picked`)
    }
    const item = (await itemsOf(container, order_id)).find((i) => i.id === item_id)
    if (!item) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${order_id} has no line ${item_id}`)
    const picked = "add" in pick ? (record.picks?.[item_id] ?? 0) + pick.add : pick.picked
    if (picked > item.quantity) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Only ${item.quantity} of line ${item_id} were ordered${"add" in pick ? ", and all are picked" : ""}`
      )
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
