/** A saved product as the wishlist shows it: the shop's listing, or null once the shop stops selling it. */
type SavedItem = { listing: { offers: readonly { id: string }[] } | null }

export type WishlistMove = { kind: "move"; offerId: string } | { kind: "choose" } | { kind: "unavailable" }

/**
 * What "Move to cart" does for a saved product: move the shop's only variant, send the
 * buyer to the product page to choose a size or colour, or nothing once the shop stopped selling it.
 */
export function moveToCart(item: SavedItem): WishlistMove {
  const offers = item.listing?.offers ?? []
  if (!offers.length) return { kind: "unavailable" }
  if (offers.length > 1) return { kind: "choose" }
  return { kind: "move", offerId: offers[0]!.id }
}

/** Whether the buyer saved this product from this shop: a product is saved from one shop at a time. */
export function isSaved(
  items: readonly { product: { id: string }; seller_id: string }[],
  sellerId: string,
  productId: string
): boolean {
  return items.some((i) => i.product.id === productId && i.seller_id === sellerId)
}
