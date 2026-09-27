import { router } from 'expo-router';

import type { Listing } from '@/api/listings';

/** Opens a product in the listing's shop context: there is no product page without a shop (docs/design.md). */
export function openListing(listing: Pick<Listing, 'seller' | 'product'>) {
  router.push({ pathname: '/product/[id]', params: { id: listing.product.id, seller: listing.seller.id } });
}
