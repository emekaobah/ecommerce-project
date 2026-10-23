// Order again (#86): the buyer reorders one shop's part of an order they received, from the
// preview `GET /store/order-history/:id/order-again` gives (packages/api/src/lib/order-again.ts).

import { formatMoney } from "./money"

/** One line of the preview: what was ordered and paid, and its offer today. */
export type OrderAgainItemInput = {
  id: string
  product_title: string | null
  variant_title: string | null
  thumbnail: string | null
  /** How many the buyer ordered. */
  quantity: number
  paid_unit_price: number
  /** Whether today's price differs from what was paid. */
  price_changed: boolean
  /** Why it can't be added: sold out, or no longer sold; null when it can. */
  unavailable: "sold_out" | "not_sold" | null
  /** Null when the shop no longer sells it. */
  offer: {
    id: string
    unit_price: number
    compare_at_unit_price: number | null
    /** How many can be ordered (0: sold out); null when the shop doesn't track its stock. */
    available_quantity: number | null
  } | null
}

/** A line of the Order again sheet. */
export type OrderAgainLine = {
  id: string
  /** The offer to add; null when the shop no longer sells it. */
  offerId: string | null
  /** Whether it can be ticked and added. */
  addable: boolean
  /** How many would be added: what was ordered, never more than is left; 0 when it can't be added. */
  quantity: number
  /** Fewer are left than were ordered, so fewer are added. */
  capped: boolean
  /** Today's price each; null when it can't be added. */
  unitPrice: number | null
  /** Today's price for `quantity`; null when it can't be added. */
  total: number | null
  note: string | null
}

/**
 * Each line of the preview at today's price: how many to add (what was ordered, never more than
 * is left), and what changed since, "Now ₦3,800.00 each, was ₦3,500.00" and "Only 1 left". A line
 * the shop no longer sells, or has none left of, is "Not available now" and can't be added.
 */
export function orderAgainLines(items: readonly OrderAgainItemInput[], currency: string): OrderAgainLine[] {
  return items.map((item) => {
    const { offer } = item
    const left = offer?.available_quantity ?? null
    if (!offer || item.unavailable || left === 0) {
      return { id: item.id, offerId: offer?.id ?? null, addable: false, quantity: 0, capped: false, unitPrice: null, total: null, note: "Not available now" }
    }
    const capped = left !== null && left < item.quantity
    const quantity = capped ? left : item.quantity
    const notes = [
      item.price_changed ? `Now ${formatMoney(offer.unit_price, currency)} each, was ${formatMoney(item.paid_unit_price, currency)}` : null,
      capped ? `Only ${left} left` : null,
    ].filter(Boolean)
    return {
      id: item.id,
      offerId: offer.id,
      addable: true,
      quantity,
      capped,
      unitPrice: offer.unit_price,
      total: offer.unit_price * quantity,
      note: notes.length ? notes.join(" · ") : null,
    }
  })
}

/** The sheet's button: "Add 3 items to cart" counts the items on the ticked lines that can be added, with their total. */
export function orderAgainSummary(lines: readonly OrderAgainLine[], ticked: ReadonlySet<string>): { count: number; total: number; label: string } {
  const adding = lines.filter((line) => line.addable && ticked.has(line.id))
  const count = adding.reduce((sum, line) => sum + line.quantity, 0)
  const total = adding.reduce((sum, line) => sum + (line.total ?? 0), 0)
  const label = count ? `Add ${count} ${count === 1 ? "item" : "items"} to cart` : "Add to cart"
  return { count, total, label }
}

/** What the preview says of the shop: its status now (`shopStatusLabel`'s words), and why it takes no orders. */
export type OrderAgainShop = {
  not_taking_orders: "paused" | "closed" | "left" | null
  shop_status: { state: "open" | "closed" | "closed_until"; label: string; note?: string | null } | null
  seller: { name: string }
}

/**
 * What the sheet says of a shop that isn't open (catalogue b-after #4): outside its hours it still
 * takes orders, "Prepared when it opens 10am Mon"; paused or closed for a date, "Closed until Tue
 * 14 Oct" and the shop's note; gone, "Iya Bisi Foodstuff isn't selling on Oja now." Null while open.
 */
export function orderAgainClosedNote({ not_taking_orders, shop_status, seller }: OrderAgainShop): string | null {
  if (not_taking_orders === "left") return `${seller.name} isn't selling on Oja now.`
  if (not_taking_orders && !shop_status) return `${seller.name} isn't taking orders now.`
  if (!shop_status || shop_status.state === "open") return null
  if (shop_status.state === "closed") {
    // The label reads "Closed · opens 10am Mon" in the region's timezone, which the preview doesn't carry.
    const opens = shop_status.label.match(/opens (.+)$/)?.[1]
    return opens ? `Prepared when it opens ${opens}` : "Prepared when it opens"
  }
  return shop_status.note ? `${shop_status.label}. ${shop_status.note}` : shop_status.label
}
