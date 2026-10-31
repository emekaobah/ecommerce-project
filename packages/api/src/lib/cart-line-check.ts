import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { LinePrice } from "@oja/domain"
import { retrieveCartBySeller, type CartSeller } from "./cart"
import { linePriceOf } from "./cart-lines"
import { priceOffers } from "./listings"
import { liveSellerIds } from "./onboarding"
import { notTakingOrders, type NotTakingOrders, type ShopStatusView } from "./shop-hours"

// Where each cart line stands (#135), read without changing anything: the price it was added at,
// its offer's price now, how many are left, and whether its shop takes orders now. Checkout
// reprices and cuts to stock from it before payment; the cart reminder (#134) asks it what the
// cart can still be bought for without repricing or trimming the cart.

/** One cart line as it stands now. */
export type CartLineCheck = {
  line_item_id: string
  /** Null when the line has no offer (it was never linked to one). */
  offer_id: string | null
  /** The shop selling it; null when its offer is gone (the shop stopped selling it). */
  seller: CartSeller | null
  product_id: string | null
  variant_id: string | null
  product_title: string | null
  variant_title: string | null
  thumbnail: string | null
  quantity: number
  /** What the line is charged: the price its offer had when it was added (or checkout last repriced it to). */
  added_at: LinePrice
  /**
   * Its offer's price now in the cart's region; null when the offer or its shop is gone, or the
   * offer has no price in the cart's currency.
   */
  now: LinePrice | null
  /**
   * How many of its offer can still be ordered: 0 means sold out, below `quantity` means short.
   * Null when the shop doesn't track the offer's stock, takes backorders, or the offer is gone.
   */
  available_quantity: number | null
  /** The shop's status now (ADR 0004); null once it has left Oja or its offer is gone. */
  shop_status: ShopStatusView | null
  /**
   * Null while the shop takes orders now (closed outside its hours still does); otherwise paused,
   * closed for a date, or `left`: no longer live on Oja (ADR 0007), or its offer is gone.
   */
  not_taking_orders: NotTakingOrders | null
}

export type CartCheck = {
  cart_id: string
  region_id: string | null
  currency_code: string
  customer_id: string | null
  /** Shop by shop, in the order each shop's first line was added, as the cart shows them. */
  lines: CartLineCheck[]
}

type OfferRow = { id: string; seller_id: string; variant_id: string; product_variant?: { price_set?: { id: string } | null } | null }

/** Each live shop's offer's price now in the region, by offer id; an offer with no price there has no entry. */
async function pricesNow(
  scope: MedusaContainer,
  region: { id: string | null; currency_code: string },
  offerIds: string[]
): Promise<Map<string, LinePrice>> {
  if (!offerIds.length || !region.id) return new Map()
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "offer",
    fields: ["id", "seller_id", "variant_id", "product_variant.price_set.id"],
    filters: { id: offerIds },
  })
  const priced = await priceOffers(scope, { id: region.id, currency_code: region.currency_code }, data as unknown as OfferRow[])
  return new Map(priced.map((o) => [o.id, linePriceOf(o.calculated_price)]))
}

/**
 * Where each of the cart's lines stands now. Reads only: the cart, its lines and their prices
 * are left as they are. A cart that doesn't exist is not found.
 */
export async function checkCartLines(scope: MedusaContainer, cartId: string, now = new Date()): Promise<CartCheck> {
  const cart = await retrieveCartBySeller(scope, cartId, now)
  const hasShop = cart.sellers.some((g) => g.seller)
  const live = new Set(hasShop ? await liveSellerIds(scope) : [])
  const groups = cart.sellers.map((g) => ({ ...g, live: !!g.seller && live.has(g.seller.id) }))
  const liveOfferIds = groups.flatMap((g) => (g.live ? g.items.flatMap((i) => (i.offer_id ? [i.offer_id] : [])) : []))
  const prices = await pricesNow(scope, { id: cart.region_id, currency_code: cart.currency_code }, [...new Set(liveOfferIds)])

  return {
    cart_id: cart.id,
    region_id: cart.region_id,
    currency_code: cart.currency_code,
    customer_id: cart.customer_id,
    lines: groups.flatMap((g) => {
      const shopStatus = g.live ? g.shop_status : null
      return g.items.map((item) => ({
        line_item_id: item.id,
        offer_id: item.offer_id,
        seller: g.seller,
        product_id: item.product_id,
        variant_id: item.variant_id,
        product_title: item.product_title,
        variant_title: item.variant_title,
        thumbnail: item.thumbnail,
        quantity: item.quantity,
        added_at: {
          unit_price: item.unit_price,
          compare_at_unit_price: item.compare_at_unit_price,
          is_tax_inclusive: item.is_tax_inclusive,
        },
        now: (g.live && item.offer_id && prices.get(item.offer_id)) || null,
        available_quantity: item.available_quantity,
        shop_status: shopStatus,
        not_taking_orders: notTakingOrders(shopStatus),
      }))
    }),
  }
}
