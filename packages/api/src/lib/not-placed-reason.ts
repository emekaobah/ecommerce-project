import type { NotPlacedReason } from "@oja/domain"

// Why a paid cart wasn't placed (#38): the error its completion failed with says, where Medusa
// or Mercur raised it for a reason the buyer can act on.

/** The start of each error a cart's completion fails with for a known reason. */
const FAILURES: [string, NotPlacedReason][] = [
  // Medusa's promotion module, registering a code's use past its limit or budget.
  ["Promotion usage exceeds the", "code_used_up"],
  // Medusa's inventory module reserving stock, and its check of a variant's inventory.
  ["Not enough stock available", "sold_out"],
  ["Some variant does not have the required inventory", "sold_out"],
  // Mercur's checks of the cart's lines and deliveries.
  ["The cart items required to be assigned to a seller", "unavailable"],
  ["No shipping method selected", "delivery"],
  ["The cart items require shipping profiles", "delivery"],
]

/** Which reason a cart gives when fixing it found more than one thing wrong. */
const REASONS: NotPlacedReason[] = ["code_used_up", "sold_out", "unavailable", "delivery"]

/**
 * Why a paid cart wasn't placed: what its completion's error (`failure`) says, or else the first
 * thing fixing the cart found (`causes`), or `other`.
 */
export function notPlacedReason(failure: string | null, causes: Set<NotPlacedReason>): NotPlacedReason {
  const said = failure ? FAILURES.find(([start]) => failure.startsWith(start))?.[1] : undefined
  return said ?? REASONS.find((r) => causes.has(r)) ?? "other"
}
