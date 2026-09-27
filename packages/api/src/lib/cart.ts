import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { priceOffers } from "./listings"

// The buyer's cart shown shop by shop: a cart can hold several shops' offers, and each shop
// ships (and later becomes an order) on its own (docs/design.md). Items are added, changed and
// removed through Medusa's and Mercur's cart routes; this only reads the cart back grouped.

export type CartSeller = { id: string; name: string; handle: string }

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
  /** `unit_price` × `quantity`, before shipping and promotions. */
  subtotal: number
}

export type CartSellerGroup = {
  /** Null for items whose offer is gone: the shop stopped selling it, so it can only be removed. */
  seller: CartSeller | null
  items: CartItem[]
  item_subtotal: number
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
  created_at: string | Date
  metadata: Record<string, unknown> | null
  offer?: { id: string } | null
}

type CartRow = {
  id: string
  region_id: string | null
  currency_code: string
  customer_id: string | null
  items?: ItemRow[] | null
}

/** Mercur links each line item to its offer and also stamps `offer_id` in its metadata. */
function offerIdOf(item: ItemRow): string | null {
  if (item.offer?.id) return item.offer.id
  const fromMetadata = item.metadata?.offer_id
  return typeof fromMetadata === "string" && fromMetadata.length ? fromMetadata : null
}

async function sellersByOffer(scope: MedusaContainer, offerIds: string[]): Promise<Map<string, CartSeller>> {
  if (!offerIds.length) return new Map()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: offers } = await query.graph({ entity: "offer", fields: ["id", "seller_id"], filters: { id: offerIds } })
  const sellerIds = [...new Set((offers as { seller_id: string }[]).map((o) => o.seller_id))]
  const { data: sellers } = sellerIds.length
    ? await query.graph({ entity: "seller", fields: ["id", "name", "handle"], filters: { id: sellerIds } })
    : { data: [] }
  const byId = new Map((sellers as CartSeller[]).map((s) => [s.id, { id: s.id, name: s.name, handle: s.handle }]))
  const byOffer = new Map<string, CartSeller>()
  for (const offer of offers as { id: string; seller_id: string }[]) {
    const seller = byId.get(offer.seller_id)
    if (seller) byOffer.set(offer.id, seller)
  }
  return byOffer
}

function toItem(row: ItemRow, offerId: string | null): CartItem {
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
    subtotal: unitPrice * quantity,
  }
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

/** What a line item is charged: its offer's price, pinned so Medusa's cart refreshes can't reprice it. */
export type OfferLinePrice = {
  offer_id: string
  variant_id: string
  unit_price: number
  compare_at_unit_price: number | null
  is_tax_inclusive: boolean
}

/**
 * Prices an offer for a cart at its own shop's price in the cart's region.
 *
 * Medusa prices cart lines per variant, and Mercur's cart pricing hooks put every offer in the
 * cart into one pricing context, so when two shops sell the same variant a quantity change,
 * sign-in (cart transfer) or address change reprices both lines at the cheaper shop's price.
 * Lines therefore carry their offer's price as a custom price, which those refreshes keep.
 * A shop's later price change reaches the line when its quantity next changes; checkout
 * must reprice before payment.
 */
export async function offerLinePrice(scope: MedusaContainer, cartId: string, offerId: string): Promise<OfferLinePrice> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const [{ data: carts }, { data: offers }] = await Promise.all([
    query.graph({ entity: "cart", fields: ["id", "region_id", "currency_code"], filters: { id: cartId } }),
    query.graph({
      entity: "offer",
      fields: ["id", "variant_id", "product_variant.price_set.id"],
      filters: { id: offerId },
    }),
  ])
  const cart = carts[0] as { region_id: string | null; currency_code: string } | undefined
  if (!cart) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Cart ${cartId} not found`)
  const offer = offers[0] as { id: string; variant_id: string; product_variant?: { price_set?: { id: string } | null } }
  if (!offer) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Offer ${offerId} not found`)
  if (!cart.region_id) throw new MedusaError(MedusaError.Types.INVALID_DATA, "The cart has no region to price it in")

  const [priced] = await priceOffers(scope, { id: cart.region_id, currency_code: cart.currency_code }, [offer])
  if (!priced) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Offer ${offerId} has no price in the cart's currency`)
  }
  const { calculated_amount, original_amount, is_calculated_price_tax_inclusive } = priced.calculated_price
  const unitPrice = Number(calculated_amount)
  const originalPrice = Number(original_amount ?? calculated_amount)
  return {
    offer_id: offer.id,
    variant_id: offer.variant_id,
    unit_price: unitPrice,
    // A sale shows the shop's normal price struck through, as on the product page.
    compare_at_unit_price: originalPrice > unitPrice ? originalPrice : null,
    is_tax_inclusive: !!is_calculated_price_tax_inclusive,
  }
}

/** The offer a line item was added from, or null when it has none. */
export async function lineItemOfferId(scope: MedusaContainer, cartId: string, lineItemId: string) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "line_item",
    fields: ["id", "cart_id", "metadata", "offer.id"],
    filters: { id: lineItemId, cart_id: cartId },
  })
  const item = data[0] as ItemRow | undefined
  return item ? offerIdOf(item) : null
}

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
      "items.created_at",
      "items.metadata",
      "items.offer.id",
    ],
    filters: { id: cartId },
  })
  const cart = data[0] as CartRow | undefined
  if (!cart) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Cart ${cartId} not found`)

  const rows = [...(cart.items ?? [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id.localeCompare(b.id)
  )
  const offerIds = rows.map(offerIdOf)
  const sellers = await sellersByOffer(scope, [...new Set(offerIds.filter((id): id is string => !!id))])

  const groups = new Map<string, CartSellerGroup>()
  rows.forEach((row, i) => {
    const offerId = offerIds[i]
    const seller = (offerId && sellers.get(offerId)) || null
    const key = seller?.id ?? ""
    const group = groups.get(key) ?? { seller, items: [], item_subtotal: 0 }
    group.items.push(toItem(row, offerId))
    groups.set(key, group)
  })
  const sellerGroups = [...groups.values()].map((g) => ({ ...g, item_subtotal: sum(g.items.map((i) => i.subtotal)) }))

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
