import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

// The buyer's order history (#17): each checkout is an order group, split into one order per
// shop. Mercur's own `/store/order-groups` asks for more nested relations than Medusa allows a
// store route, so the buyer's view is read here.

type Scope = Pick<MedusaContainer, "resolve">

export type BuyerOrderItem = {
  id: string
  product_id: string | null
  product_title: string | null
  variant_title: string | null
  thumbnail: string | null
  quantity: number
  unit_price: number
  total: number
}

/** One shop's order of a checkout, as its buyer sees it. */
export type BuyerOrder = {
  id: string
  display_id: number
  created_at: string
  currency_code: string
  seller: { id: string; name: string; handle: string | null; logo: string | null }
  items: BuyerOrderItem[]
}

/** A checkout, as its buyer sees it: the shops' orders it was split into. */
export type BuyerOrderGroup = {
  id: string
  display_id: number
  created_at: string
  orders: BuyerOrder[]
}

const ORDER_FIELDS = [
  "id",
  "display_id",
  "created_at",
  "currency_code",
  "seller.id",
  "seller.name",
  "seller.handle",
  "seller.logo",
  "items.id",
  "items.product_id",
  "items.product_title",
  "items.variant_title",
  "items.thumbnail",
  "items.quantity",
  "items.detail.quantity",
  "items.unit_price",
  "items.total",
]

type GroupRow = { id: string; display_id: number; created_at: Date | string; orders?: ({ id: string } | null)[] | null }

/** The buyer's order groups, newest first. */
export async function listBuyerOrderGroups(
  scope: Scope,
  customerId: string,
  page: { limit: number; offset: number }
): Promise<{ order_groups: BuyerOrderGroup[]; count: number }> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data, metadata } = await query.graph({
    entity: "order_group",
    fields: ["id", "display_id", "created_at", "orders.id"],
    filters: { customer_id: customerId },
    pagination: { skip: page.offset, take: page.limit, order: { created_at: "DESC" } },
  })
  return { order_groups: await withOrders(scope, data as GroupRow[]), count: metadata?.count ?? 0 }
}

/** One of the buyer's order groups; another buyer's is not found. */
export async function retrieveBuyerOrderGroup(scope: Scope, customerId: string, id: string): Promise<BuyerOrderGroup> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order_group",
    fields: ["id", "display_id", "created_at", "orders.id"],
    filters: { id, customer_id: customerId },
  })
  const [group] = await withOrders(scope, data as GroupRow[])
  if (!group) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order group with id ${id} was not found`)
  return group
}

async function withOrders(scope: Scope, groups: GroupRow[]): Promise<BuyerOrderGroup[]> {
  const ids = groups.flatMap((g) => (g.orders ?? []).flatMap((o) => (o ? [o.id] : [])))
  const orders = await buyerOrders(scope, ids)
  return groups.map((g) => ({
    id: g.id,
    display_id: g.display_id,
    created_at: new Date(g.created_at).toISOString(),
    orders: (g.orders ?? []).flatMap((o) => {
      const order = o && orders.get(o.id)
      return order ? [order] : []
    }),
  }))
}

async function buyerOrders(scope: Scope, ids: string[]): Promise<Map<string, BuyerOrder>> {
  if (!ids.length) return new Map()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order", fields: ORDER_FIELDS, filters: { id: ids } })
  return new Map((data as any[]).map((o) => [o.id, buyerOrder(o)]))
}

function buyerOrder(o: any): BuyerOrder {
  return {
    id: o.id,
    display_id: o.display_id,
    created_at: new Date(o.created_at).toISOString(),
    currency_code: o.currency_code,
    seller: {
      id: o.seller?.id,
      name: o.seller?.name,
      handle: o.seller?.handle ?? null,
      logo: o.seller?.logo ?? null,
    },
    items: (o.items ?? []).map((i: any) => ({
      id: i.id,
      product_id: i.product_id ?? null,
      product_title: i.product_title ?? null,
      variant_title: i.variant_title ?? null,
      thumbnail: i.thumbnail ?? null,
      quantity: Number(i.detail?.quantity ?? i.quantity),
      unit_price: Number(i.unit_price),
      total: Number(i.total),
    })),
  }
}
