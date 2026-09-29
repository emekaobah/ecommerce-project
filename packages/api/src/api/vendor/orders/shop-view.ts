import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { shopOrderView, type OrderShare, type VendorOrder } from "../../../lib/shop-order"

type Body = { order?: VendorOrder; orders?: VendorOrder[]; [key: string]: unknown }

async function sharesOf(scope: MedusaContainer, orderIds: string[]) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "total", "transactions.amount", "transactions.reference", "transactions.reference_id"],
    filters: { id: orderIds },
  })
  return new Map(
    (data as { id: string; total: number; transactions?: OrderShare["transactions"] | null }[]).map((o) => [
      o.id,
      { total: Number(o.total), transactions: (o.transactions ?? []).map((t) => ({ ...t, amount: Number(t.amount) })) },
    ])
  )
}

async function shopView(scope: MedusaContainer, body: Body): Promise<Body> {
  const orders = [...(body.order ? [body.order] : []), ...(body.orders ?? [])]
  const ids = orders.map((o) => o.id).filter((id): id is string => typeof id === "string")
  if (!ids.length) return body
  const shares = await sharesOf(scope, ids)
  const view = (order: VendorOrder) => {
    const share = shares.get(order.id as string)
    // Never guess a share: showing ₦0 paid would misstate the shop's money.
    if (!share) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `No payment share found for order ${order.id}`)
    return shopOrderView(order, share)
  }
  return {
    ...body,
    ...(body.order && { order: view(body.order) }),
    ...(body.orders && { orders: body.orders.map(view) }),
  }
}

/**
 * Every vendor order response shows the shop its own order (lib/shop-order): its share of the
 * checkout's payment, and only its own prices. Mercur's order routes answer through res.json,
 * so the order is cut down on the way out.
 */
export function showTheShopItsOwnOrder(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const send = res.json.bind(res)
  res.json = (body: Body) => {
    shopView(req.scope, body).then(send, next)
    return res
  }
  next()
}
