/**
 * How many of an offer can still be sold, where the buyer decides: on listings, the product,
 * Home's shops and the cart (#66), and when a paid cart is fixed (#38).
 */

/** What one stock location holds of a part. */
export type StockLevel = { stocked_quantity: number; reserved_quantity: number }

/** An offer's stock: whether it is tracked, and each inventory part it is made of. */
export type OfferStock = {
  manage_inventory: boolean | null
  allow_backorder: boolean | null
  /** Each part with how many go into one unit, and what each location holds of it. */
  parts: { required_quantity: number | null; levels: StockLevel[] }[]
}

/**
 * How many units can still be sold: as many as the scarcest part allows, each part counted at
 * the location with the most of it (one unit ships from one place). Null when stock isn't
 * tracked or backorders are allowed: the offer is always available.
 */
export function availableQuantity(stock: OfferStock): number | null {
  if (!stock.manage_inventory || stock.allow_backorder) return null
  const units = stock.parts.map((part) => {
    const free = part.levels.map((l) => Number(l.stocked_quantity) - Number(l.reserved_quantity))
    return Math.floor(Math.max(0, ...free) / (part.required_quantity || 1))
  })
  return units.length ? Math.min(...units) : 0
}

/** Why a cart line can't be had as it stands: none left, or fewer than it wants. */
export type StockShortfall = { type: "sold_out" } | { type: "short"; left: number }

/** What stock a line wanting `quantity` lacks, given what is available (null: always available). */
export function stockShortfall(quantity: number, available: number | null): StockShortfall | null {
  if (available === null || available >= quantity) return null
  return available <= 0 ? { type: "sold_out" } : { type: "short", left: available }
}

/** Below this many left, the product and cart say how many (catalogue: "Below five left"). */
const LOW_STOCK = 5

/** "Only 3 left" when stock runs low; null while there's plenty, it isn't tracked, or none is left (that reads "Sold out"). */
export function stockLeftLabel(available: number | null): string | null {
  return available !== null && available > 0 && available < LOW_STOCK ? `Only ${available} left` : null
}
