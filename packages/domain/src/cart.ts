type HeldCart = { id: string; itemCount: number }

export type CartOnSignIn =
  | { kind: "merge"; cartId: string; fromCartId: string }
  | { kind: "adopt-guest"; cartId: string }
  | { kind: "keep-buyer"; cartId: string | null }

/**
 * Which cart a buyer shops with after signing in on this device, so nothing either cart held
 * is lost: the guest's items join the buyer's own cart, or the guest cart becomes theirs when
 * they had nothing in a cart here. An emptied guest cart is dropped.
 */
export function cartOnSignIn({
  guestCart,
  buyerCart,
}: {
  guestCart: HeldCart | null
  buyerCart: HeldCart | null
}): CartOnSignIn {
  if (!guestCart || guestCart.itemCount === 0) return { kind: "keep-buyer", cartId: buyerCart?.id ?? null }
  if (buyerCart && buyerCart.itemCount > 0) return { kind: "merge", cartId: buyerCart.id, fromCartId: guestCart.id }
  return { kind: "adopt-guest", cartId: guestCart.id }
}
