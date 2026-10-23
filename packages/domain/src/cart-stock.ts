import { itemsLabel } from "./items-label"

/**
 * What the cart says about lines the shop can't fill as they stand (catalogue Cart): sold-out
 * lines block checkout until they're dealt with, and a short line offers what's left.
 */

/** The cart's main button while sold-out lines remain: "Remove 1 sold-out item". */
export function soldOutButtonLabel(count: number): string {
  return `Remove ${itemsLabel(count, "sold-out")}`
}

/**
 * A line wanting more than is left (`stockShortfall` says "short"): how many remain and the
 * one-tap fix, "Only 2 left · Change to 2". Said however many are left, unlike the low-stock
 * "Only N left", because the line can't be had as it stands.
 */
export function shortLineLabel(left: number): string {
  return `Only ${left} left · Change to ${left}`
}
