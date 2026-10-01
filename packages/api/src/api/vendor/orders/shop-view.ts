import { fulfilmentViews } from "../../../lib/order-fulfilment"
import { shopOrderView, type VendorOrder } from "../../../lib/shop-order"
import { shareFor, sharesOf, viewResponses } from "../shop-share"

/**
 * Every vendor order response shows the shop its own order: its payment share and its own
 * prices. Each order also carries its `fulfilment`: its state, and while New, its accept deadline.
 */
export const showTheShopItsOwnOrder = viewResponses(async (req, body) => {
  const { order, orders } = body as { order?: VendorOrder; orders?: VendorOrder[] }
  const all = [...(order ? [order] : []), ...(orders ?? [])]
  if (!all.length) return body
  const ids = all.map((o) => o.id as string)
  const [shares, fulfilments] = await Promise.all([sharesOf(req.scope, ids), fulfilmentViews(req.scope, ids)])
  const view = (o: VendorOrder) => ({
    ...shopOrderView(o, shareFor(shares, o.id as string)),
    fulfilment: fulfilments.get(o.id as string),
  })
  return { ...body, ...(order && { order: view(order) }), ...(orders && { orders: orders.map(view) }) }
})
