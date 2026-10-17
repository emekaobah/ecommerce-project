import { ownPaymentStatuses } from "../../lib/admin-checkout"
import { viewResponses } from "../vendor/shop-share"

type Order = { id: string; payment_status?: string; [key: string]: unknown }
type Group = { orders?: Order[] | null; [key: string]: unknown }
type Body = { order?: Order; orders?: Order[]; order_group?: Group; order_groups?: Group[] }

/**
 * Every admin order and order group response shows each order its own payment status (#14),
 * not the checkout's: the order's payment collections stay the checkout's shared one.
 */
export const showEachOrderItsOwnPaymentStatus = viewResponses(async (req, body) => {
  const { order, orders, order_group, order_groups } = body as Body
  const groups = [...(order_group ? [order_group] : []), ...(order_groups ?? [])]
  const all = [...(order ? [order] : []), ...(orders ?? []), ...groups.flatMap((g) => g.orders ?? [])].filter(
    (o) => o && "payment_status" in o
  )
  if (!all.length) return body
  const statuses = await ownPaymentStatuses(req.scope, [...new Set(all.map((o) => o.id))])
  for (const o of all) o.payment_status = statuses.get(o.id) ?? o.payment_status
  return body
})
