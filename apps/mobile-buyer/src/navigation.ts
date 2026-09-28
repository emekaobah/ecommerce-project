import { router } from 'expo-router';

import type { Listing } from '@/api/listings';

/** Opens a product in the listing's shop context: there is no product page without a shop (docs/design.md). */
export function openListing(listing: Pick<Listing, 'seller' | 'product'>) {
  router.push({ pathname: '/product/[id]', params: { id: listing.product.id, seller: listing.seller.id } });
}

/** Opens a shop's page: its header and every product it sells. */
export function openShop(seller: Pick<Listing['seller'], 'id'>) {
  router.push({ pathname: '/seller/[id]', params: { id: seller.id } });
}

/** Opens a category's listings; the name titles the screen before anything loads. */
export function openCategory(category: { id: string; name: string }) {
  router.push({ pathname: '/category/[id]', params: { id: category.id, name: category.name } });
}
