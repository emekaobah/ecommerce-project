import { skipToken, useQuery } from '@tanstack/react-query';

import { storeClient } from './client';

type ListFilters = { sellerId?: string; excludeProductId?: string; limit?: number };

export const listingKeys = {
  all: ['listings'] as const,
  list: (regionId: string, filters: ListFilters = {}) => [...listingKeys.all, 'list', { regionId, ...filters }] as const,
  detail: (regionId: string, sellerId: string, productId: string) =>
    [...listingKeys.all, 'detail', { regionId, sellerId, productId }] as const,
};

async function fetchListings(regionId: string, { sellerId, excludeProductId, limit }: ListFilters) {
  return storeClient.store.listings.query({
    region_id: regionId,
    ...(sellerId ? { seller_id: sellerId } : {}),
    ...(excludeProductId ? { exclude_product_id: excludeProductId } : {}),
    ...(limit ? { limit } : {}),
  });
}

async function fetchListing(regionId: string, sellerId: string, productId: string) {
  const { listing } = await storeClient.store.listings.$sellerId.$productId.query({
    $sellerId: sellerId,
    $productId: productId,
    region_id: regionId,
  });
  return listing;
}

export type Listing = Awaited<ReturnType<typeof fetchListings>>['listings'][number];
export type ListingDetail = Awaited<ReturnType<typeof fetchListing>>;

/** Shop listings visible in the region: the feed, or one shop's (for same-shop suggestions). */
export function useListings(regionId: string | undefined, filters: ListFilters = {}) {
  return useQuery({
    queryKey: listingKeys.list(regionId ?? '', filters),
    queryFn: regionId ? async () => (await fetchListings(regionId, filters)).listings : skipToken,
  });
}

/** One shop's listing of a product, for the product page. */
export function useListing(regionId: string | undefined, sellerId: string, productId: string) {
  return useQuery({
    queryKey: listingKeys.detail(regionId ?? '', sellerId, productId),
    queryFn: regionId ? () => fetchListing(regionId, sellerId, productId) : skipToken,
  });
}
