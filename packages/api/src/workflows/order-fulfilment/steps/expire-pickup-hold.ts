import { ContainerRegistrationKeys, MathBN, MedusaError } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { fulfilmentsOf } from "../../../lib/order-fulfilment"
import { perishableLinesOf } from "../../../lib/perishable"

type Scope = Parameters<typeof fulfilmentsOf>[0]

/**
 * What a pickup order's expired hold does to it (#32): the order edit taking every non-perishable
 * line to none, the order's total before it, and whether paid
 * perishable lines are left for the shop to be paid for.
 */
export type HoldExpiryPlan = { items: { id: string; quantity: number }[]; total_before: number; perishable_left: boolean }

/** Works out what the hold's expiry removes; refuses an order that isn't Ready for pickup. */
export const planHoldExpiryStep = createStep("plan-pickup-hold-expiry", async ({ order_id }: { order_id: string }, { container }) => {
  const record = (await fulfilmentsOf(container, [order_id])).get(order_id)
  if (record?.state !== "ready_for_pickup") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Order ${order_id} isn't ready for pickup: its hold can't expire`)
  }
  const lines = (await perishableLinesOf(container, [order_id])).get(order_id) ?? []
  const removed = lines.filter((l) => !l.perishable)
  return new StepResponse<HoldExpiryPlan>({
    items: removed.map((l) => ({ id: l.id, quantity: 0 })),
    total_before: await orderTotal(container, order_id),
    perishable_left: lines.some((l) => l.perishable && l.total > 0),
  })
})

/** Once the order edit is confirmed: what it took off the order's total, which the buyer is refunded. */
export const holdRemovalAmountStep = createStep(
  "pickup-hold-removal-amount",
  async ({ order_id, total_before }: { order_id: string; total_before: number }, { container }) => {
    const removedAmount = MathBN.convert(MathBN.sub(total_before, await orderTotal(container, order_id))).toNumber()
    return new StepResponse(removedAmount)
  }
)

async function orderTotal(container: Scope, orderId: string): Promise<number> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order", fields: ["id", "total"], filters: { id: orderId } })
  return Number(data[0]?.total ?? 0)
}
