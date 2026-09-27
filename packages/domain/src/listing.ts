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

/** The shop's lead time to ship, in days. */
export function shipsIn(days: number): string {
  if (days <= 0) return "Ships today"
  return `Ships in ${days} ${days === 1 ? "day" : "days"}`
}

/** Product weight, stored in grams (docs/design.md), for the details section. */
export function formatWeight(grams: number, locale?: string): string {
  const format = (value: number, unit: "gram" | "kilogram") =>
    new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "short", maximumFractionDigits: 2 }).format(value)
  return grams < 1000 ? format(grams, "gram") : format(grams / 1000, "kilogram")
}
