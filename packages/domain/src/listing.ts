import { formatMoney } from "./money"

// How a shop listing is shown. Listings are always one shop's offer (no cross-shop
// comparison), so these rules only ever pick between one shop's own variants.

/** An offer's price in the region's currency, as the listings API returns it. */
export type PricedOffer = { id: string; calculated_price: { calculated_amount: number; original_amount: number } }

export type DisplayPrice = {
  amount: number
  /** Struck-through "was" price; only when it is above the selling price. */
  compareAt: number | null
}

export function offerPrice({ calculated_price }: PricedOffer): DisplayPrice {
  const { calculated_amount, original_amount } = calculated_price
  return { amount: calculated_amount, compareAt: original_amount > calculated_amount ? original_amount : null }
}

export type ListingPrice = DisplayPrice & {
  /** The shop's variants are priced differently; show "From". */
  from: boolean
  /** The cheapest offer, which the product page selects first. */
  offerId: string
}

/**
 * A listing's headline price: the shop's cheapest variant, marked "from" when its variants
 * are priced differently.
 */
export function listingPrice(offers: PricedOffer[]): ListingPrice | undefined {
  const [first, ...rest] = offers
  if (!first) return undefined
  const cheapest = rest.reduce(
    (min, o) => (o.calculated_price.calculated_amount < min.calculated_price.calculated_amount ? o : min),
    first
  )
  const amounts = new Set(offers.map((o) => o.calculated_price.calculated_amount))
  return { ...offerPrice(cheapest), from: amounts.size > 1, offerId: cheapest.id }
}

/**
 * One of a listing's shop's automatic promotions that applies to the product (#6). Only ever that
 * shop's own: no badge compares shops (docs/design.md).
 */
export type ShopDeal = {
  type: "percentage" | "fixed"
  value: number
  /** `each`: off every unit; `across`/`once`: off what is bought from the shop. */
  allocation: "each" | "across" | "once"
  currency_code: string
}

/** The badge for a shop's deal, e.g. "10% off at this shop". */
export function dealLabel(deal: ShopDeal, locale?: string): string {
  if (deal.type === "percentage") return `${deal.value}% off at this shop`
  const amount = formatMoney(deal.value, deal.currency_code, locale)
  return deal.allocation === "each" ? `${amount} off each at this shop` : `${amount} off at this shop`
}

/** The shop's lead time to ship, in days. */
export function shipsIn(days: number): string {
  if (days <= 0) return "Ships today"
  return `Ships in ${days} ${days === 1 ? "day" : "days"}`
}

/**
 * Product weight, stored in grams (docs/design.md), for the details section. The unit is
 * appended here rather than with `style: "unit"`, which iOS converts to the device locale's
 * system (pounds on en-US).
 */
export function formatWeight(grams: number, locale?: string): string {
  const format = (value: number, unit: "g" | "kg") =>
    `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)} ${unit}`
  return grams < 1000 ? format(grams, "g") : format(grams / 1000, "kg")
}

export type ShopGroup<L extends { seller: { id: string } }> = { seller: L["seller"]; listings: L[] }

/**
 * Search and category results under a header per shop (docs/design.md). Results arrive in
 * the listing order, so a shop comes where its best result came and keeps its own order.
 */
export function groupByShop<L extends { seller: { id: string } }>(listings: L[]): ShopGroup<L>[] {
  const groups = new Map<string, ShopGroup<L>>()
  for (const listing of listings) {
    const group = groups.get(listing.seller.id)
    if (group) group.listings.push(listing)
    else groups.set(listing.seller.id, { seller: listing.seller, listings: [listing] })
  }
  return [...groups.values()]
}

const SIZE = /^\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l|litres?|liters?)\b/i
/** Each unit in grams or millilitres, so a product's weights (or volumes) share one scale; "litre" spelled out is a litre. */
const LITRE = 1000
const UNIT_SCALE: Record<string, number> = { g: 1, kg: 1000, ml: 1, cl: 10, l: LITRE }
const CLOTHING = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"]
const CLOTHING_ALIASES: Record<string, string> = { "2XL": "XXL", "3XL": "XXXL" }

/**
 * A size's place on one scale: grams or millilitres for weights and volumes, the letter's place
 * for clothing; null when it isn't one we can measure.
 */
function sizeRank(title: string | null): number | null {
  const letter = (title ?? "").trim().toUpperCase()
  const clothing = CLOTHING.indexOf(CLOTHING_ALIASES[letter] ?? letter)
  if (clothing >= 0) return clothing
  const match = SIZE.exec(title ?? "")
  const [, amount, unit] = match ?? []
  if (!amount || !unit) return null
  return Number(amount) * (UNIT_SCALE[unit.toLowerCase()] ?? LITRE)
}

/**
 * A product's sizes small to large, whatever order the shop added them in. Sizes that can't be
 * measured keep their order, after the ones that can.
 */
export function bySize<O extends { variant_title: string | null }>(offers: O[]): O[] {
  return offers
    .map((offer, index) => ({ offer, index, rank: sizeRank(offer.variant_title) }))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.index - b.index)
    .map(({ offer }) => offer)
}
