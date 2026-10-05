import { formatMoney } from "./money"

/** What a cart line is charged for one. */
export type LinePrice = { unit_price: number; compare_at_unit_price: number | null; is_tax_inclusive: boolean }

/** A cart line checkout repriced from its shop's offer: what it was, and what it is now. */
export type PriceChange = {
  line_item_id: string
  product_title: string | null
  variant_title: string | null
  seller: { name: string }
  was: LinePrice
  now: LinePrice
}

const vat = (inclusive: boolean) => (inclusive ? "VAT included" : "plus VAT")

/**
 * Tells the buyer, before they pay, how a line's price changed since they added it: a shop's new
 * price, a sale starting or ending, or VAT no longer included.
 */
export function priceChangeMessage({ product_title, variant_title, seller, was, now }: PriceChange, currencyCode: string): string {
  const money = (amount: number) => formatMoney(amount, currencyCode)
  // A single variant is titled like its product.
  const title = product_title ?? "An item"
  const name = variant_title && variant_title !== product_title ? `${title} (${variant_title})` : title
  const vatChanged = was.is_tax_inclusive !== now.is_tax_inclusive
  const nowText = `${money(now.unit_price)} each${now.is_tax_inclusive ? "" : " plus VAT"}`
  const wasText =
    was.unit_price === now.unit_price
      ? vat(was.is_tax_inclusive)
      : `${money(was.unit_price)}${vatChanged ? ` ${vat(was.is_tax_inclusive)}` : ""}`
  return `${name} from ${seller.name} is now ${nowText} (was ${wasText})${saleReason(was, now)}.`
}

const onSale = (price: LinePrice) => price.compare_at_unit_price != null

function saleReason(was: LinePrice, now: LinePrice): string {
  if (onSale(was) && !onSale(now)) return ": the sale ended"
  if (!onSale(was) && onSale(now)) return ": it's on sale"
  return ""
}
