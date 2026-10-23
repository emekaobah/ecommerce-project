import { dateLabel } from "./date-label"

/** The courier the buyer chose at checkout, as checkout saved it on the order's shipping method. */
type CourierQuote = { courier_name?: string; delivery_eta_time?: string }

/** What the vendor's order screen reads the buyer line from. */
export type BuyerLineOrder = {
  billing_address?: { first_name?: string | null; last_name?: string | null } | null
  shipping_address?: { city?: string | null } | null
  shipping_methods?: readonly ({ data?: unknown } | null | undefined)[] | null
  fulfilment: { method: "delivery" | "pickup"; shipment: unknown }
}

const quoteOf = (order: BuyerLineOrder) =>
  (order.shipping_methods ?? [])
    .map((method) => (method?.data as { quote?: CourierQuote } | null | undefined)?.quote)
    .find((quote): quote is Required<CourierQuote> => !!quote?.courier_name && !!quote.delivery_eta_time)

/** "Tolu A.": the buyer's first name and initial. */
function buyerName(order: BuyerLineOrder): string | null {
  const first = order.billing_address?.first_name?.trim()
  if (!first) return null
  const initial = order.billing_address?.last_name?.trim().charAt(0)
  return initial ? `${first} ${initial}.` : first
}

/**
 * Who the order is for and how it reaches them, as the shop's staff read it: "For Tolu A. ·
 * Surulere · buyer chose GIG, arriving Thu". The buyer's courier shows until a label is booked,
 * when the courier block takes over; a pickup order is collected in store.
 */
export function orderBuyerLine(order: BuyerLineOrder, timeZone: string): string {
  const name = buyerName(order)
  const parts = [name ? `For ${name}` : null]
  if (order.fulfilment.method === "pickup") return [...parts, "collecting in store"].filter(Boolean).join(" · ")
  parts.push(order.shipping_address?.city?.trim() || null)
  const quote = order.fulfilment.shipment ? undefined : quoteOf(order)
  if (quote) parts.push(`buyer chose ${quote.courier_name}, arriving ${dateLabel(quote.delivery_eta_time, timeZone, { date: false })}`)
  return parts.filter(Boolean).join(" · ")
}
