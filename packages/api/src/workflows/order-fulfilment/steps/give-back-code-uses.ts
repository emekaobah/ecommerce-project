import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MathBN, Modules } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"

// A checkout registers one use of each promo code it was paid with (ADR 0010), though the code
// may discount several of the shops' orders it splits into. A use is given back only once every
// order of the checkout that the code discounted is cancelled (#17): until then the buyer still
// has something the code paid for.

type Scope = Pick<MedusaContainer, "resolve">

type Adjusted = { adjustments?: ({ code?: string | null; amount?: unknown } | null)[] | null } | null
type OrderRow = {
  id: string
  status: string
  email?: string | null
  customer_id?: string | null
  items?: Adjusted[] | null
  shipping_methods?: Adjusted[] | null
}

/** What each code took off the order, by code. */
function discountsByCode(order: OrderRow): Map<string, ReturnType<typeof MathBN.convert>> {
  const byCode = new Map<string, ReturnType<typeof MathBN.convert>>()
  for (const line of [...(order.items ?? []), ...(order.shipping_methods ?? [])]) {
    for (const adjustment of line?.adjustments ?? []) {
      if (!adjustment?.code) continue
      byCode.set(adjustment.code, MathBN.add(byCode.get(adjustment.code) ?? 0, Number(adjustment.amount ?? 0)))
    }
  }
  return byCode
}

/** The orders the order's checkout was split into, the order among them. */
async function ordersOfCheckout(scope: Scope, orderId: string): Promise<OrderRow[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: links } = await query.graph({ entity: "order_group_order", fields: ["order_group_id"], filters: { order_id: orderId } })
  const groupId = (links[0] as unknown as { order_group_id?: string } | undefined)?.order_group_id
  const { data: members } = groupId
    ? await query.graph({ entity: "order_group_order", fields: ["order_id"], filters: { order_group_id: groupId } })
    : { data: [{ order_id: orderId }] }
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "status",
      "email",
      "customer_id",
      "items.adjustments.code",
      "items.adjustments.amount",
      "shipping_methods.adjustments.code",
      "shipping_methods.adjustments.amount",
    ],
    filters: { id: (members as unknown as { order_id: string }[]).map((m) => m.order_id) },
  })
  return data as unknown as OrderRow[]
}

type GivenBack = { codes: { code: string; amount: number }[]; context: { customer_id: string | null; customer_email: string | null } }

/**
 * Once an order is cancelled, gives back the use of each code on it that no other order of its
 * checkout still has (every order it discounted is cancelled), with what all those orders took
 * off for a campaign's spend budget. Run under the checkout's lock, so two of its orders
 * cancelled at once can't both give a use back, or neither.
 */
export const giveBackCodeUsesStep = createStep(
  "give-back-code-uses",
  async ({ order_id }: { order_id: string }, { container }) => {
    const orders = (await ordersOfCheckout(container, order_id)).map((o) => ({ ...o, discounts: discountsByCode(o) }))
    const order = orders.find((o) => o.id === order_id)
    if (!order) return new StepResponse(undefined, null)
    const codes = [...order.discounts.keys()].flatMap((code) => {
      const using = orders.filter((o) => o.discounts.has(code))
      if (using.some((o) => o.status !== "canceled")) return []
      const amount = using.reduce((sum, o) => MathBN.add(sum, o.discounts.get(code) ?? 0), MathBN.convert(0))
      return [{ code, amount: MathBN.convert(amount).toNumber() }]
    })
    if (!codes.length) return new StepResponse(undefined, null)
    const context = { customer_id: order.customer_id ?? null, customer_email: order.email ?? null }
    await container.resolve(Modules.PROMOTION).revertUsage(codes, context)
    return new StepResponse<undefined, GivenBack | null>(undefined, { codes, context })
  },
  async (givenBack: GivenBack | null | undefined, { container }) => {
    if (givenBack) await container.resolve(Modules.PROMOTION).registerUsage(givenBack.codes, givenBack.context)
  }
)

/** The key of the lock on the order's checkout (its order group), under which its code uses are given back. */
export const checkoutOfOrderStep = createStep("checkout-of-order", async ({ order_id }: { order_id: string }, { container }) => {
  const { data } = await container
    .resolve(ContainerRegistrationKeys.QUERY)
    .graph({ entity: "order_group_order", fields: ["order_group_id"], filters: { order_id } })
  const groupId = (data[0] as unknown as { order_group_id?: string } | undefined)?.order_group_id
  return new StepResponse(`checkout-codes:${groupId ?? order_id}`)
})
