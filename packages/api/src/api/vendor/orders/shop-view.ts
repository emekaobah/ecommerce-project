import type { MedusaRequest } from "@medusajs/framework/http"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getOrdersListWorkflow } from "@medusajs/medusa/core-flows"
import { fulfilmentViews, unrecordedOrdersOf } from "../../../lib/order-fulfilment"
import { perishableProductIds } from "../../../lib/perishable"
import { shopOrderView, type VendorOrder } from "../../../lib/shop-order"
import type { VendorRequest } from "../offer-import/seller"
import { shareFor, sharesOf, viewResponses } from "../shop-share"

type ListCount = (req: MedusaRequest, count: number) => Promise<number>

/**
 * Each response shows the shop its own order: its payment share and its own prices. Each order
 * also carries its `fulfilment`: its state, and while New, its accept deadline. Each line it
 * shows says whether it is `perishable` (#70).
 * An order still being placed, not yet recorded, is shown once it is: it is left out of a list,
 * and not found on its own. `listCount` gives the list's count without such orders.
 */
const shopOrderResponses = (listCountOf: ListCount) => viewResponses(async (req, body) => {
  const { order, orders, count } = body as { order?: VendorOrder; orders?: VendorOrder[]; count?: number }
  const all = [...(order ? [order] : []), ...(orders ?? [])]
  const listCount = orders && count != null ? listCountOf(req, count) : undefined
  if (!all.length) return { ...body, ...(listCount && { count: await listCount }) }
  const ids = all.map((o) => o.id as string)
  const [shares, fulfilments, perishable, recorded] = await Promise.all([
    sharesOf(req.scope, ids),
    fulfilmentViews(req.scope, ids),
    perishableLines(req.scope, all),
    listCount,
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
    ...(recorded != null && { count: recorded }),
  }
})

/** Mercur's `/vendor/orders`: its list and count include orders not recorded yet. */
export const showTheShopItsOwnOrder = shopOrderResponses(recordedCount)

/**
 * A stage's orders (#69): listed and counted from the fulfilment rows, so only recorded orders,
 * and its count already leaves the others out (#92).
 */
export const showTheShopItsStageOrders = shopOrderResponses(async (_req, count) => count)

/**
 * Mercur's count of the shop's orders the list matches, less those not recorded yet: the
 * list leaves them out, so its count does too. Such orders are few and seconds old, so the
 * ones the list's filters match are counted again among them alone.
 */
async function recordedCount(req: MedusaRequest, count: number): Promise<number> {
  const sellerId = (req as VendorRequest).seller_context?.seller_id
  if (!sellerId) return count
  const unrecorded = await unrecordedOrdersOf(req.scope, sellerId)
  const filters = (req.filterableFields ?? {}) as Record<string, unknown>
  const asked = filters.id == null ? null : new Set([filters.id].flat() as string[])
  const ids = asked ? unrecorded.filter((id) => asked.has(id)) : unrecorded
  if (!ids.length) return count
  const { result } = await getOrdersListWorkflow(req.scope).run({
    input: { fields: ["id"], variables: { filters: { ...filters, is_draft_order: false, id: ids }, skip: 0, take: ids.length } },
  })
  return count - (result as unknown as { metadata: { count: number } }).metadata.count
}

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
