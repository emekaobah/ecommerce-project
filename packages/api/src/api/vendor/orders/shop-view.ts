import { shopOrderView, type VendorOrder } from "../../../lib/shop-order"
import { shareFor, sharesOf, viewResponses } from "../shop-share"

/** Every vendor order response shows the shop its own order: its payment share and its own prices. */
export const showTheShopItsOwnOrder = viewResponses(async (req, body) => {
  const { order, orders } = body as { order?: VendorOrder; orders?: VendorOrder[] }
  const all = [...(order ? [order] : []), ...(orders ?? [])]
  if (!all.length) return body
  const shares = await sharesOf(req.scope, all.map((o) => o.id as string))
  const view = (o: VendorOrder) => shopOrderView(o, shareFor(shares, o.id as string))
  return { ...body, ...(order && { order: view(order) }), ...(orders && { orders: orders.map(view) }) }
})
