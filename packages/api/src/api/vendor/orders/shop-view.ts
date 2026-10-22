import { MedusaError } from "@medusajs/framework/utils"
import { fulfilmentViews } from "../../../lib/order-fulfilment"
import { shopOrderView, type VendorOrder } from "../../../lib/shop-order"
import { shareFor, sharesOf, viewResponses } from "../shop-share"

/**
 * Every vendor order response shows the shop its own order: its payment share and its own
 * prices. Each order also carries its `fulfilment`: its state, and while New, its accept deadline.
 * An order still being placed, not yet recorded, is shown once it is: it is left out of a list,
 * and not found on its own.
 */
export const showTheShopItsOwnOrder = viewResponses(async (req, body) => {
  const { order, orders } = body as { order?: VendorOrder; orders?: VendorOrder[] }
  const all = [...(order ? [order] : []), ...(orders ?? [])]
  if (!all.length) return body
  const ids = all.map((o) => o.id as string)
  const [shares, fulfilments] = await Promise.all([sharesOf(req.scope, ids), fulfilmentViews(req.scope, ids)])
  const view = (o: VendorOrder) => {
    const fulfilment = fulfilments.get(o.id as string)
    return fulfilment && { ...shopOrderView(o, shareFor(shares, o.id as string)), fulfilment }
  }
  if (order && !fulfilments.has(order.id as string)) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order with id: ${order.id} was not found`)
  }
  return {
    ...body,
    ...(order && { order: view(order) }),
    ...(orders && { orders: orders.flatMap((o) => view(o) ?? []) }),
  }
})
