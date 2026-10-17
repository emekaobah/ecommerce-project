import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { fulfilmentsOf, type Picks } from "../../../lib/order-fulfilment"
import { HOLD_LINE_FIELDS, holdLinesOf, type OrderLineRow } from "../../../lib/pickup-hold"

/**
 * What a pickup order's hold expiring does to it (#32): the order edit that takes its
 * non-perishable lines off (each to none), and whether perishable lines stay on it for the shop.
 * `refunded` and `kept`: the units of each line taken off and refunded, and left for the shop.
 */
export type HoldExpiryPlan = { items: { id: string; quantity: number }[]; perishable_kept: boolean; refunded: Picks; kept: Picks }

/** Works out the hold's expiry; refuses an order that isn't Ready for pickup. */
export const planHoldExpiryStep = createStep("plan-pickup-hold-expiry", async ({ order_id }: { order_id: string }, { container }) => {
  const record = (await fulfilmentsOf(container, [order_id])).get(order_id)
  if (record?.state !== "ready_for_pickup") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Order ${order_id} isn't ready for pickup: its hold can't expire`)
  }
  const { data } = await container.resolve(ContainerRegistrationKeys.QUERY).graph({
    entity: "order",
    fields: ["id", ...HOLD_LINE_FIELDS],
    filters: { id: order_id },
  })
  const order = data[0] as unknown as { id: string; items?: OrderLineRow[] | null }
  const lines = (await holdLinesOf(container, [order])).get(order_id) ?? []
  const units = (perishable: boolean) => Object.fromEntries(lines.filter((l) => l.perishable === perishable).map((l) => [l.id, l.quantity]))
  return new StepResponse<HoldExpiryPlan>({
    items: lines.filter((l) => !l.perishable).map((l) => ({ id: l.id, quantity: 0 })),
    perishable_kept: lines.some((l) => l.perishable),
    refunded: units(false),
    kept: units(true),
  })
})
