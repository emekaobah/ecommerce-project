import { ContainerRegistrationKeys, MathBN, MedusaError } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { fulfilmentsOf, HOLD_LINE_FIELDS, holdLinesOf, type OrderLineRow } from "../../../lib/order-fulfilment"

type Scope = Parameters<typeof fulfilmentsOf>[0]

/**
 * What a pickup order's hold expiring does to it (#32): the order edit that takes its
 * non-perishable lines off (each to none), whether perishable lines stay on it for the shop,
 * and the order's total before.
 */
export type HoldExpiryPlan = { items: { id: string; quantity: number }[]; perishable_kept: boolean; total_before: number }

/** Works out the hold's expiry; refuses an order that isn't Ready for pickup. */
export const planHoldExpiryStep = createStep("plan-pickup-hold-expiry", async ({ order_id }: { order_id: string }, { container }) => {
  const record = (await fulfilmentsOf(container, [order_id])).get(order_id)
  if (record?.state !== "ready_for_pickup") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Order ${order_id} isn't ready for pickup: its hold can't expire`)
  }
  const { data } = await container.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "order",
    fields: ["id", "total", ...HOLD_LINE_FIELDS],
    filters: { id: order_id },
  })
  const order = data[0] as unknown as { id: string; total: unknown; items?: OrderLineRow[] | null }
  const lines = (await holdLinesOf(container, [order])).get(order_id) ?? []
  return new StepResponse<HoldExpiryPlan>({
    items: lines.filter((l) => !l.perishable).map((l) => ({ id: l.id, quantity: 0 })),
    perishable_kept: lines.some((l) => l.perishable),
    total_before: Number(order.total),
  })
})

/** What the order edit took off the order's total, which is the buyer's refund. */
export const removedAmountStep = createStep(
  "pickup-hold-removed-amount",
  async ({ order_id, total_before }: { order_id: string; total_before: number }, { container }) => {
    return new StepResponse(MathBN.convert(MathBN.sub(total_before, await orderTotal(container, order_id))).toNumber())
  }
)

async function orderTotal(container: Scope, orderId: string): Promise<number> {
  const { data } = await container
    .resolve(ContainerRegistrationKeys.QUERY)
    .graph({ entity: "order", fields: ["id", "total"], filters: { id: orderId } })
  return Number(data[0]?.total ?? 0)
}
