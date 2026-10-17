import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MathBN, Modules } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { sharedCodesOf, withoutSharedCodes } from "../../../lib/shared-codes"

// A checkout registers one use of each promo code it was paid with (ADR 0010), though the code
// may discount several of the shops' orders it splits into. A code shared by a cart and its shop
// cart (`lib/shared-codes.ts`) counts one use for both checkouts. A use is given back only once
// every order that the code discounted, of the checkout and of each checkout sharing the code,
// is cancelled or rejected (#17): until then the buyer still has something the code paid for.

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

/** The cart the order's checkout paid for, and the codes it shares with each other cart. */
async function checkoutOf(scope: Scope, orderId: string) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: links } = await query.graph({ entity: "order_cart", fields: ["cart_id"], filters: { order_id: orderId } })
  const cartId = (links[0] as { cart_id?: string } | undefined)?.cart_id
  if (!cartId) return null
  const { data: carts } = await query.graph({ entity: "cart", fields: ["metadata"], filters: { id: cartId } })
  return { cart_id: cartId, shared: sharedCodesOf((carts[0] as { metadata?: Record<string, unknown> | null } | undefined)?.metadata) }
}

/** Each order the carts' checkouts were split into, with the cart it came from. */
async function ordersOfCarts(scope: Scope, cartIds: string[]): Promise<(OrderRow & { cart_id: string })[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: links } = await query.graph({ entity: "order_cart", fields: ["order_id", "cart_id"], filters: { cart_id: cartIds } })
  const cartOf = new Map((links as { order_id: string; cart_id: string }[]).map((l) => [l.order_id, l.cart_id]))
  if (!cartOf.size) return []
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
    filters: { id: [...cartOf.keys()] },
  })
  return (data as unknown as OrderRow[]).map((order) => ({ ...order, cart_id: cartOf.get(order.id)! }))
}

type Usage = { codes: { code: string; amount: number }[]; context: { customer_id: string | null; customer_email: string | null } }
type GivenBack = Usage & { carts: { id: string; metadata: Record<string, unknown> | null }[] }

/**
 * Once an order is cancelled, gives back the use of each code on it that no order of its checkout,
 * nor of a checkout sharing the code, still has (every order it discounted is cancelled), with
 * what all those orders took off for a campaign's spend budget. The carts then share the code no
 * more, so a sharing cart not yet paid for counts a use of its own when it is. Run under the
 * locks of `codeCheckoutLocksStep`.
 */
export const giveBackCodeUsesStep = createStep(
  "give-back-code-uses",
  async ({ order_id }: { order_id: string }, { container }) => {
    const checkout = await checkoutOf(container, order_id)
    if (!checkout) return new StepResponse(undefined, null)
    const sharers = Object.keys(checkout.shared)
    const orders = (await ordersOfCarts(container, [checkout.cart_id, ...sharers])).map((o) => ({ ...o, discounts: discountsByCode(o) }))
    const order = orders.find((o) => o.id === order_id)
    if (!order) return new StepResponse(undefined, null)
    const codes = [...order.discounts.keys()].flatMap((code) => {
      const carts = new Set([checkout.cart_id, ...sharers.filter((id) => checkout.shared[id].includes(code))])
      const using = orders.filter((o) => carts.has(o.cart_id) && o.discounts.has(code))
      if (using.some((o) => o.status !== "canceled")) return []
      const amount = using.reduce((sum, o) => MathBN.add(sum, o.discounts.get(code) ?? 0), MathBN.convert(0))
      return [{ code, amount: MathBN.convert(amount).toNumber() }]
    })
    if (!codes.length) return new StepResponse(undefined, null)
    const context = { customer_id: order.customer_id ?? null, customer_email: order.email ?? null }
    await container.resolve(Modules.PROMOTION).revertUsage(codes, context)

    const given = codes.map((c) => c.code)
    const unsharing = sharers.filter((id) => checkout.shared[id].some((code) => given.includes(code)))
    const cartModule = container.resolve(Modules.CART)
    const carts = unsharing.length
      ? (await cartModule.listCarts({ id: [checkout.cart_id, ...unsharing] }, { select: ["id", "metadata"] })).map(({ id, metadata }) => ({
          id,
          metadata: metadata ?? null,
        }))
      : []
    if (carts.length) {
      const ids = carts.map((c) => c.id)
      await cartModule.updateCarts(
        carts.map(({ id, metadata }) => ({ id, metadata: withoutSharedCodes(metadata, ids.filter((other) => other !== id), given) }))
      )
    }
    return new StepResponse<undefined, GivenBack | null>(undefined, { codes, context, carts })
  },
  async (givenBack: GivenBack | null | undefined, { container }) => {
    if (!givenBack) return
    await container.resolve(Modules.PROMOTION).registerUsage(givenBack.codes, givenBack.context)
    if (givenBack.carts.length) await container.resolve(Modules.CART).updateCarts(givenBack.carts)
  }
)

/**
 * The locks under which an order's code uses are given back: its checkout's cart and each cart
 * sharing a code with it. Two orders of the checkouts sharing a code, cancelled at once, take the
 * same locks, so they can't both give its use back, or neither; a sharing cart not yet paid for
 * is the lock Mercur's completion takes on it, so it is paid before or after, not during.
 */
export const codeCheckoutLocksStep = createStep("code-checkout-locks", async ({ order_id }: { order_id: string }, { container }) => {
  const checkout = await checkoutOf(container, order_id)
  return new StepResponse(checkout ? [checkout.cart_id, ...Object.keys(checkout.shared)].sort((a, b) => a.localeCompare(b)) : [`order-codes:${order_id}`])
})
