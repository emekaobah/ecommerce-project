import { skipToken, useQuery } from '@tanstack/react-query';

import { storeClient } from './client';
import { isNotFound } from './errors';

type ListFilters = {
  /** Words the product's name must all hold. */
  search?: string;
  categoryId?: string;
  sellerId?: string;
  excludeProductId?: string;
  limit?: number;
};

export const listingKeys = {
  all: ['listings'] as const,
  list: (regionId: string, filters: ListFilters = {}) => [...listingKeys.all, 'list', { regionId, ...filters }] as const,
  detail: (regionId: string, sellerId: string, productId: string) =>
    [...listingKeys.all, 'detail', { regionId, sellerId, productId }] as const,
};

async function fetchListings(regionId: string, { search, categoryId, sellerId, excludeProductId, limit }: ListFilters) {
  return storeClient.store.listings.query({
    region_id: regionId,
    ...(search ? { q: search } : {}),
    ...(categoryId ? { category_id: categoryId } : {}),
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

/**
 * Shop listings visible in the region, in the backend's order (best match, then fastest shop;
 * never by price): the feed, search and category results, or one shop's.
 */
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
    // The shop stopped selling it.
    retry: (failures, error) => !isNotFound(error) && failures < 1,
  });
}

