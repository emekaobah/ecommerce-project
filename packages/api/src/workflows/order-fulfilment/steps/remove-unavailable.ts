import { transition } from "@oja/domain"
import { ContainerRegistrationKeys, MathBN, MedusaError } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { asFulfilmentRecord, fulfilmentService, fulfilmentsOf, type FulfilmentRecord, type Picks } from "../../../lib/order-fulfilment"
import { itemsOf } from "../../../lib/order-picking"

type Scope = Parameters<typeof fulfilmentsOf>[0]

/** Each line's quantity once its unavailable units are gone, for the order edit, and the units removed of each. */
export type RemovalPlan = { items: { id: string; quantity: number }[]; units: Picks; total_before: number }

/**
 * Works out the order edit that removes the units marked unavailable: each marked line's new
 * quantity, and the order's total before it. Refuses an order with nothing marked, and one
 * that would be left with nothing to send.
 */
export const planRemovalStep = createStep("plan-unavailable-removal", async ({ order_id }: { order_id: string }, { container }) => {
  const record = (await fulfilmentsOf(container, [order_id])).get(order_id)
  const marked = Object.entries(record?.unavailable ?? {}).filter(([, count]) => count > 0)
  if (record?.state !== "partially_available" || !marked.length) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Order ${order_id} has no items marked unavailable to remove`)
  }
  const lines = await itemsOf(container, order_id)
  const items = marked.map(([id, count]) => {
    const line = lines.find((l) => l.id === id)
    if (!line) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${order_id} has no line ${id}`)
    return { id, quantity: line.quantity - count }
  })
  const left = lines.reduce((sum, line) => sum + (items.find((i) => i.id === line.id)?.quantity ?? line.quantity), 0)
  if (left <= 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Every item of order ${order_id} is marked unavailable: there would be nothing left to send`
    )
  }
  return new StepResponse<RemovalPlan>({ items, units: Object.fromEntries(marked), total_before: await orderTotal(container, order_id) })
})

type Compensation = Pick<FulfilmentRecord, "id" | "state" | "fulfilment" | "unavailable" | "removed">

/**
 * Once the order edit is confirmed: the marked units are recorded as removed, the marks are
 * cleared and the order goes back to Picking. Returns the fulfilment and what the edit took
 * off the order's total, which is what the buyer is owed.
 */
export const recordRemovalStep = createStep(
  "record-unavailable-removal",
  async ({ order_id, actor, total_before }: { order_id: string; actor: string; total_before: number }, { container }) => {
    const record = (await fulfilmentsOf(container, [order_id])).get(order_id)!
    const removed: Picks = { ...record.removed }
    for (const [id, count] of Object.entries(record.unavailable ?? {})) removed[id] = (removed[id] ?? 0) + count
    const moved = transition(record.fulfilment, { source: "staff", type: "resume_picking", actor, at: new Date().toISOString() })
    if (!moved.ok) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Order ${order_id} can't go back to picking`)
    const saved = await fulfilmentService(container).updateOrderFulfilments({
      id: record.id,
      unavailable: null,
      removed,
      state: moved.fulfilment.state,
      fulfilment: moved.fulfilment,
    })
    const removedAmount = MathBN.convert(MathBN.sub(total_before, await orderTotal(container, order_id))).toNumber()
    const previous: Compensation = {
      id: record.id,
      state: record.state,
      fulfilment: record.fulfilment,
      unavailable: record.unavailable,
      removed: record.removed,
    }
    return new StepResponse({ fulfilment: asFulfilmentRecord(saved), removed_amount: removedAmount }, previous)
  },
  async (previous: Compensation | undefined, { container }) => {
    if (previous) await fulfilmentService(container).updateOrderFulfilments(previous)
  }
)

async function orderTotal(container: Scope, orderId: string): Promise<number> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order", fields: ["id", "total"], filters: { id: orderId } })
  return Number(data[0]?.total ?? 0)
}
