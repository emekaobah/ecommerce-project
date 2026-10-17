import type { BuyerPush } from "./buyer-push"
import { formatMoney } from "./money"

/**
 * A paid cart that failed to become orders (#38): it is refunded in full and fixed for the buyer
 * to pay again. These say why, and what changed in the cart.
 */

/** Why a paid cart wasn't placed. */
export type NotPlacedReason = "code_used_up" | "sold_out" | "unavailable" | "delivery" | "other"

/** What fixing the cart changed, so the buyer can pay the new total. */
export type NotPlacedChange =
  | { type: "code_removed"; code: string }
  | {
      type: "quantity_reduced"
      product_title: string | null
      variant_title: string | null
      seller: string | null
      was: number
      now: number
    }
  | { type: "item_removed"; product_title: string | null; variant_title: string | null; seller: string | null; quantity: number }
  | { type: "delivery_removed"; seller: string | null }

/** A cart that wasn't placed: why, and what was refunded. */
export type NotPlaced = { reason: NotPlacedReason; amount: number }

const WHY: Record<NotPlacedReason, string> = {
  code_used_up: "This code was used up while you paid.",
  sold_out: "An item sold out while you paid.",
  unavailable: "An item or shop is no longer available.",
  delivery: "This delivery option is no longer available.",
  other: "Something went wrong placing your order.",
}

/** Why the cart wasn't placed, and that the buyer has been refunded. */
export function notPlacedMessage({ reason, amount }: NotPlaced, currencyCode: string): string {
  return `${WHY[reason]} You've been refunded ${formatMoney(amount, currencyCode)}.`
}

/** "Adire Kaftan (M) from Aso Oke House"; a single variant is titled like its product. */
function itemName(item: { product_title: string | null; variant_title: string | null; seller: string | null }) {
  const title = item.product_title ?? "An item"
  const name = item.variant_title && item.variant_title !== item.product_title ? `${title} (${item.variant_title})` : title
  return item.seller ? `${name} from ${item.seller}` : name
}

/** One change fixing the cart made, for the buyer to see before paying again. */
export function notPlacedChangeMessage(change: NotPlacedChange): string {
  switch (change.type) {
    case "code_removed":
      return `${change.code} was taken off.`
    case "quantity_reduced":
      return `${itemName(change)}: only ${change.now} left, so you now have ${change.now} (was ${change.was}).`
    case "item_removed":
      return `${itemName(change)} was removed.`
    case "delivery_removed":
      return change.seller ? `Choose a new delivery for ${change.seller}.` : "Choose a new delivery."
  }
}

/** The push telling the buyer their paid cart wasn't placed, and what they were refunded. */
export function notPlacedPush(notPlaced: NotPlaced, currencyCode: string): BuyerPush {
  return { title: "Your order wasn't placed", body: notPlacedMessage(notPlaced, currencyCode) }
}
