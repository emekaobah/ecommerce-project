import type { ReviewKind } from '@oja/domain';
import { router } from 'expo-router';

import type { Listing } from '@/api/listings';

/** Opens a product in the listing's shop context: there is no product page without a shop (docs/design.md). */
export function openListing(listing: { seller: Pick<Listing['seller'], 'id'>; product: Pick<Listing['product'], 'id'> }) {
  router.push({ pathname: '/product/[id]', params: { id: listing.product.id, seller: listing.seller.id } });
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
