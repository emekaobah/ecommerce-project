import type { ReviewKind } from '@oja/domain';
import { router } from 'expo-router';

import type { Listing } from '@/api/listings';

/** Opens a product in the listing's shop context: there is no product page without a shop (docs/design.md). */
export function openListing(listing: { seller: Pick<Listing['seller'], 'id'>; product: Pick<Listing['product'], 'id'> }) {
  router.push({ pathname: '/product/[id]', params: { id: listing.product.id, seller: listing.seller.id } });
}

/**
 * The product a cart line opens, in the shop it's from (`openListing`): none once that shop
 * stopped selling it (`seller` is null), so the line opens nothing.
 */
export function cartLineListing(group: { seller: { id: string } | null }, item: { product_id: string | null }) {
  return group.seller && item.product_id ? { seller: { id: group.seller.id }, product: { id: item.product_id } } : null;
}

/** Opens a shop's page: its header and every product it sells. */
export function openShop(seller: Pick<Listing['seller'], 'id'>) {
  router.push({ pathname: '/seller/[id]', params: { id: seller.id } });
}

/** Opens one of the buyer's order groups: each shop's order of a checkout. */
export function openOrderGroup(group: { id: string }) {
  router.push({ pathname: '/order/[id]', params: { id: group.id } });
}

/** Opens every published review of a shop or product; the title names what they're of. */
export function openReviews(kind: ReviewKind, id: string, title: string) {
  router.push({ pathname: '/reviews', params: { kind, id, title } });
}

/** Opens the form to review one shop's order of an order group, once the buyer has received it (#7). */
export function openWriteReview(group: { id: string }, order: { id: string }) {
  router.push({ pathname: '/review/[id]', params: { id: order.id, group: group.id } });
}

/** Opens a category's listings; the name titles the screen before anything loads. */
export function openCategory(category: { id: string; name: string }) {
  router.push({ pathname: '/category/[id]', params: { id: category.id, name: category.name } });
}

/** Opens every review the buyer has written (#81). */
export function openMyReviews() {
  router.push('/my-reviews');
}

/**
 * Opens the cart as a sheet over the current screen, so the buyer comes back to it: switching to
 * the Cart tab would discard a product or order opened above the tabs.
 */
export function openCartSheet() {
  router.push('/cart-sheet');
}

/**
 * Closes the sheet in front, then goes on. Called from a sheet route, so the next screen opens
 * over the screen under the sheet rather than inside the sheet.
 */
export function closeSheetThen(go: () => void) {
  router.back();
  go();
}
