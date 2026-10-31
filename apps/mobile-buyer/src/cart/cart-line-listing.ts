/**
 * The product a cart line opens, in the shop it's from (`openListing`): none once that shop
 * stopped selling it (`seller` is null), so the line opens nothing.
 */
export function cartLineListing(group: { seller: { id: string } | null }, item: { product_id: string | null }) {
  return group.seller && item.product_id ? { seller: { id: group.seller.id }, product: { id: item.product_id } } : null;
}
