import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { fulfilmentViews } from "../../../lib/order-fulfilment"
import { perishableProductIds } from "../../../lib/perishable"
import { shopOrderView, type VendorOrder } from "../../../lib/shop-order"
import { shareFor, sharesOf, viewResponses } from "../shop-share"

/**
 * Every vendor order response shows the shop its own order: its payment share and its own
 * prices. Each order also carries its `fulfilment`: its state, and while New, its accept deadline.
 * Each line it shows says whether it is `perishable` (#70). An order not recorded yet is New
 * (`fulfilmentViews`), so a list shows every order its count counts.
 */
export const showTheShopItsOwnOrder = viewResponses(async (req, body) => {
  const { order, orders } = body as { order?: VendorOrder; orders?: VendorOrder[] }
  const all = [...(order ? [order] : []), ...(orders ?? [])]
  if (!all.length) return body
  const ids = all.map((o) => o.id as string)
  const [shares, fulfilments, perishable] = await Promise.all([
    sharesOf(req.scope, ids),
    fulfilmentViews(req.scope, ids),
    perishableLines(req.scope, all),
  ])
  const view = (o: VendorOrder) => {
    const fulfilment = fulfilments.get(o.id as string)
    if (!fulfilment) return undefined
    const shown = shopOrderView(o, shareFor(shares, o.id as string))
    const items = shown.items?.map((line) => ({ ...line, perishable: perishable.has(line.id as string) }))
    return { ...shown, ...(items && { items }), fulfilment }
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

/**
 * The perishable lines among the orders' lines shown, by line id. Looked up by line, as a
 * request may leave out each line's product.
 */
async function perishableLines(scope: MedusaContainer, orders: VendorOrder[]): Promise<Set<string>> {
  const lineIds = orders.flatMap((o) => (o.items ?? []).map((line) => line.id as string))
  if (!lineIds.length) return new Set()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order_line_item", fields: ["id", "product_id"], filters: { id: lineIds } })
  const lines = data as { id: string; product_id: string | null }[]
  const perishable = await perishableProductIds(
    scope,
    lines.flatMap((line) => (line.product_id ? [line.product_id] : []))
  )
  return new Set(lines.flatMap((line) => (line.product_id && perishable.has(line.product_id) ? [line.id] : [])))
}
