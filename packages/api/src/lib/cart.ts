import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { availableQuantities } from "./availability"
import { offerIdOf } from "./cart-lines"
import { discountsByCode } from "./discount-funding"
import { perishableProductIds } from "./perishable"
import { shopStatusesOf, type ShopStatusView } from "./shop-hours"

// The buyer's cart shown shop by shop: a cart can hold several shops' offers, and each shop
// ships (and later becomes an order) on its own (docs/design.md). This reads the cart back
// grouped; lines are priced and added in `cart-lines.ts`.

/** The shop a cart group belongs to; `logo` and `banner` are null when it hasn't uploaded them. */
export type CartSeller = { id: string; name: string; handle: string; logo: string | null; banner: string | null }

export type CartItem = {
  id: string
  offer_id: string | null
  product_id: string | null
  variant_id: string | null
  product_title: string | null
  variant_title: string | null
  thumbnail: string | null
  quantity: number
  /** The shop's price for one, in the cart's currency. */
  unit_price: number
  /** The shop's normal price when this one is a sale. */
  compare_at_unit_price: number | null
  /** Whether `unit_price` includes VAT, as the currency's price preference says. */
  is_tax_inclusive: boolean
  /** `unit_price` × `quantity`, before shipping and promotions. */
  subtotal: number
  /**
   * What promotions take off the line, VAT included, by code (#6): a shop's own promotion only
   * ever discounts its own items. `subtotal` less these is what the buyer pays for it.
   */
  discounts: CartDiscount[]
  /** Fresh or chilled: its shop delivers it only by the end of the next day (#69). */
  perishable: boolean
  /**
   * How many of its offer can still be ordered: 0 means sold out, below `quantity` means short.
   * Null when the shop doesn't track the offer's stock, takes backorders, or the offer is gone.
   * The line stays in the cart either way, and Medusa's totals still count it.
   */
  available_quantity: number | null
}

/** What one promo code (or automatic promotion) takes off a line. */
export type CartDiscount = { code: string; amount: number }

export type CartSellerGroup = {
  /** Null for items whose offer is gone: the shop stopped selling it, so it can only be removed. */
  seller: CartSeller | null
  items: CartItem[]
  item_subtotal: number
  /** What promotions take off the shop's items, VAT included. */
  discount_total: number
  /** Some of the shop's items are perishable: it delivers only by rates arriving by the end of the next day (#69). */
  perishable: boolean
  /**
   * Whether the shop is open (ADR 0004): outside its hours the order is prepared when it opens;
   * in a closed exception or paused (`orderable` false) its items can't be paid for. Null with `seller`.
   */
  shop_status: ShopStatusView | null
}

export type CartBySeller = {
  id: string
  region_id: string | null
  currency_code: string
  customer_id: string | null
  /** Units across every shop, for the cart badge. */
  item_count: number
  item_subtotal: number
  /** In the order each shop's first item was added. */
  sellers: CartSellerGroup[]
}

type ItemRow = {
  id: string
  product_id: string | null
  variant_id: string | null
  product_title: string | null
  variant_title: string | null
  thumbnail: string | null
  quantity: number | string
  unit_price: number | string
  compare_at_unit_price: number | string | null
  is_tax_inclusive: boolean | null
  created_at: string | Date
  metadata: Record<string, unknown> | null
  offer?: { id: string } | null
  tax_lines?: { rate: number | string }[] | null
  adjustments?: { code: string | null; amount: number | string; is_tax_inclusive: boolean | null }[] | null
}

type CartRow = {
  id: string
  region_id: string | null
  currency_code: string
  customer_id: string | null
  items?: ItemRow[] | null
}

async function sellersByOffer(scope: MedusaContainer, offerIds: string[]): Promise<Map<string, CartSeller>> {
  if (!offerIds.length) return new Map()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: offers } = await query.graph({ entity: "offer", fields: ["id", "seller_id"], filters: { id: offerIds } })
  const sellerIds = [...new Set((offers as { seller_id: string }[]).map((o) => o.seller_id))]
  const { data: sellers } = sellerIds.length
    ? await query.graph({ entity: "seller", fields: ["id", "name", "handle", "logo", "banner"], filters: { id: sellerIds } })
    : { data: [] }
  const byId = new Map(
    (sellers as unknown as CartSeller[]).map((s) => [
      s.id,
      { id: s.id, name: s.name, handle: s.handle, logo: s.logo ?? null, banner: s.banner ?? null },
    ])
  )
  const byOffer = new Map<string, CartSeller>()
  for (const offer of offers as { id: string; seller_id: string }[]) {
    const seller = byId.get(offer.seller_id)
    if (seller) byOffer.set(offer.id, seller)
  }
  return byOffer
}

function toItem(row: ItemRow, offerId: string | null, perishable: boolean, available: number | null): CartItem {
  const quantity = Number(row.quantity)
  const unitPrice = Number(row.unit_price)
  return {
    id: row.id,
    offer_id: offerId,
    product_id: row.product_id ?? null,
    variant_id: row.variant_id ?? null,
    product_title: row.product_title ?? null,
    variant_title: row.variant_title ?? null,
    thumbnail: row.thumbnail ?? null,
    quantity,
    unit_price: unitPrice,
    compare_at_unit_price: row.compare_at_unit_price == null ? null : Number(row.compare_at_unit_price),
    is_tax_inclusive: !!row.is_tax_inclusive,
    subtotal: unitPrice * quantity,
    discounts: discountsByCode(row),
    perishable,
    available_quantity: available,
  }
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

/** The cart with its items grouped by the shop selling them, or not found. */
export async function retrieveCartBySeller(scope: MedusaContainer, cartId: string): Promise<CartBySeller> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "region_id",
      "currency_code",
      "customer_id",
      "items.id",
      "items.product_id",
      "items.variant_id",
      "items.product_title",
      "items.variant_title",
      "items.thumbnail",
      "items.quantity",
      "items.unit_price",
      "items.compare_at_unit_price",
      "items.is_tax_inclusive",
      "items.created_at",
      "items.metadata",
      "items.offer.id",
      "items.tax_lines.rate",
      "items.adjustments.code",
      "items.adjustments.amount",
      "items.adjustments.is_tax_inclusive",
    ],
    filters: { id: cartId },
  })
  const cart = data[0] as CartRow | undefined
  if (!cart) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Cart ${cartId} not found`)

  const rows = [...(cart.items ?? [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id.localeCompare(b.id)
  )
  const offerIds = rows.map(offerIdOf)
  const liveOfferIds = [...new Set(offerIds.filter((id): id is string => !!id))]
  const [sellers, available, perishable] = await Promise.all([
    sellersByOffer(scope, liveOfferIds),
    availableQuantities(scope, liveOfferIds),
    perishableProductIds(scope, rows.flatMap((r) => (r.product_id ? [r.product_id] : []))),
  ])

  const groups = new Map<string, CartSellerGroup>()
  rows.forEach((row, i) => {
    const offerId = offerIds[i]
    const seller = (offerId && sellers.get(offerId)) || null
    const key = seller?.id ?? ""
    const group = groups.get(key) ?? {
      seller,
      items: [],
      item_subtotal: 0,
      discount_total: 0,
      perishable: false,
      shop_status: null,
    }
    group.items.push(
      toItem(row, offerId, !!row.product_id && perishable.has(row.product_id), offerId ? (available.get(offerId) ?? null) : null)
    )
    groups.set(key, group)
  })
  const statuses = await shopStatusesOf(scope, [...groups.values()].flatMap((g) => (g.seller ? [g.seller.id] : [])))
  const sellerGroups = [...groups.values()].map((g) => ({
    ...g,
    shop_status: g.seller ? statuses.get(g.seller.id)! : null,
    item_subtotal: sum(g.items.map((i) => i.subtotal)),
    discount_total: sum(g.items.flatMap((i) => i.discounts.map((d) => d.amount))),
    perishable: g.items.some((i) => i.perishable),
  }))

  return {
    id: cart.id,
    region_id: cart.region_id ?? null,
    currency_code: cart.currency_code,
    customer_id: cart.customer_id ?? null,
    item_count: sum(sellerGroups.flatMap((g) => g.items.map((i) => i.quantity))),
    item_subtotal: sum(sellerGroups.map((g) => g.item_subtotal)),
    sellers: sellerGroups,
  }
}
