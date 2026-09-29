export type PaymentReturn = { kind: "paid"; reference: string } | { kind: "cancelled" }

/**
 * Where a page in the payment WebView leads. Paystack sends the buyer to the checkout's return
 * URL either way: with the transaction `reference` after paying, without one after cancelling.
 * Null while the buyer is still on Paystack's pages. Paying only means the buyer finished on
 * Paystack's side; the order waits for Paystack's webhook.
 */
export function paymentReturn(url: string, returnUrl: string): PaymentReturn | null {
  const [path, query = ""] = url.split("?", 2)
  if (path !== returnUrl) return null
  const reference = /(?:^|&)reference=([^&#]+)/.exec(query)?.[1]
  return reference ? { kind: "paid", reference: decodeURIComponent(reference) } : { kind: "cancelled" }
}
