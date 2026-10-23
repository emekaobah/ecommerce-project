import type { Order } from '@/api/orders';

/** The courier the buyer chose at checkout, as checkout saved it on the order's shipping method. */
type Quote = { courier_name?: string; delivery_eta_time?: string };

const quoteOf = (order: Order): Quote | undefined =>
  (order.shipping_methods ?? [])
    .map((method) => (method?.data as { quote?: Quote } | null | undefined)?.quote)
    .find((quote) => quote?.courier_name && quote.delivery_eta_time);

/** "Tolu A.": the buyer's first name and initial. */
function buyerName(order: Order): string | null {
  const first = order.billing_address?.first_name?.trim();
  if (!first) return null;
  const initial = order.billing_address?.last_name?.trim().charAt(0);
  return initial ? `${first} ${initial}.` : first;
}

/**
 * Who the order is for and how it reaches them: "For Tolu A. · Surulere · buyer chose GIG,
 * arriving Thu". The buyer's courier shows until a label is booked, when the courier block
 * takes over; a pickup order is collected in store.
 */
export function buyerLine(order: Order, timeZone: string): string {
  const name = buyerName(order);
  const parts = [name ? `For ${name}` : null];
  if (order.fulfilment.method === 'pickup') return [...parts, 'collecting in store'].filter(Boolean).join(' · ');
  parts.push(order.shipping_address?.city?.trim() || null);
  const quote = order.fulfilment.shipment ? undefined : quoteOf(order);
  if (quote?.courier_name && quote.delivery_eta_time) {
    const day = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' }).format(new Date(quote.delivery_eta_time));
    parts.push(`buyer chose ${quote.courier_name}, arriving ${day}`);
  }
  return parts.filter(Boolean).join(' · ');
}
