export type CartOnSignIn = { kind: "adopt-guest"; cartId: string } | { kind: "keep-buyer"; cartId: string | null }

/**
 * Which cart a buyer shops with after signing in on this device. What they put in the cart
 * as a guest carries over; a guest cart they emptied doesn't replace the cart they already
 * had here as this buyer.
 */
export function cartOnSignIn({
  guestCart,
  buyerCartId,
}: {
  guestCart: { id: string; itemCount: number } | null
  buyerCartId: string | null
}): CartOnSignIn {
  if (guestCart && guestCart.itemCount > 0) return { kind: "adopt-guest", cartId: guestCart.id }
  return { kind: "keep-buyer", cartId: buyerCartId }
}
