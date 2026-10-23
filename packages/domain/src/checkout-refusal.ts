// Why checkout refused to start a payment, worded from what the checkout itself shows rather
// than the refusal's text (#16, ADR 0004): the API's 400s carry no code that tells them apart.

/** A shop's part of the checkout, as far as starting a payment depends on it. */
export type PaymentShop = {
  seller: { name: string } | null
  method: "delivery" | "pickup" | null
  shop_status: { orderable: boolean; label: string } | null
  delivery_unavailable: { code: string } | null
}

/**
 * The checkout's blocker, in the order the API checks them: a shop not taking orders, a shop
 * no courier can deliver in time, a shop still to choose a delivery for. Null when the checkout
 * shows none, and the screen says it in its own words.
 */
export function paymentRefusal(checkout: { sellers: readonly PaymentShop[]; ready_to_pay: boolean }): string | null {
  const closed = checkout.sellers.find((g) => g.seller && g.shop_status && !g.shop_status.orderable)
  if (closed?.seller && closed.shop_status) return `${closed.seller.name} isn't taking orders now. ${closed.shop_status.label}.`
  const late = checkout.sellers.find((g) => g.seller && g.method === "delivery" && g.delivery_unavailable?.code === "perishable_too_slow")
  if (late?.seller) return `No courier can bring ${late.seller.name}'s fresh items in time. Collect them in store, or remove them.`
  if (!checkout.ready_to_pay) return "Choose how each shop's order reaches you before paying."
  return null
}
