import { transition, type StaffAction } from "@oja/domain"
import { MedusaError } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { asFulfilmentRecord, fulfilmentService, type FulfilmentRecord } from "../../../lib/order-fulfilment"
import { lineBeingPicked } from "./record-pick"

export type MarkUnavailableInput = {
  order_id: string
  item_id: string
  /** How many of the line are now unavailable; none clears the mark. */
  quantity: number
  /** The member who marked them. */
  actor: string
}

type Compensation = Pick<FulfilmentRecord, "id" | "state" | "fulfilment" | "unavailable">

/**
 * Sets how many of one line are unavailable, while the order is being picked: never past the
 * units not yet picked. The first units marked take the order from Picking to Partially
 * available; clearing the last mark takes it back, with nothing to remove.
 */
export const markUnavailableStep = createStep(
  "mark-order-items-unavailable",
  async ({ order_id, item_id, quantity, actor }: MarkUnavailableInput, { container }) => {
    const { record, item } = await lineBeingPicked(container, order_id, item_id)
    const picked = record.picks?.[item_id] ?? 0
    if (quantity + picked > item.quantity) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Only ${item.quantity - picked} of line ${item_id} are left unpicked to mark unavailable`
      )
    }
    // A cleared line stays listed with none: saving a JSON column merges into what is there.
    const counts = { ...record.unavailable, [item_id]: quantity }
    const marked = Object.values(counts).some((count) => count > 0)
    const unavailable = marked ? counts : null
    const type = marked ? "mark_partially_available" : "resume_picking"
    const trigger: StaffAction = { source: "staff", type, actor, at: new Date().toISOString() }
    // Already where the marks put it: partially available with more marked, or picking with none.
    const moved = transition(record.fulfilment, trigger)
    const fulfilment = moved.ok ? moved.fulfilment : record.fulfilment
    const saved = await fulfilmentService(container).updateOrderFulfilments({
      id: record.id,
      unavailable,
      state: fulfilment.state,
      fulfilment,
    })
    const previous: Compensation = {
      id: record.id,
      state: record.state,
      fulfilment: record.fulfilment,
      unavailable: record.unavailable,
    }
    return new StepResponse(asFulfilmentRecord(saved), previous)
  },
  async (previous: Compensation | undefined, { container }) => {
    if (previous) await fulfilmentService(container).updateOrderFulfilments(previous)
  }
)
