import { skipToken, useQuery } from '@tanstack/react-query';

import { useDeliveringToId } from '@/delivering-to/delivering-to-provider';

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

/** The buyer's saved address shops are measured from (#43); none for a guest or without one. */
type Near = { addressId: string | null };

export const listingKeys = {
  all: ['listings'] as const,
  list: (regionId: string, filters: ListFilters & Near) => [...listingKeys.all, 'list', { regionId, ...filters }] as const,
  detail: (regionId: string, sellerId: string, productId: string) =>
    [...listingKeys.all, 'detail', { regionId, sellerId, productId }] as const,
};

const near = (addressId: string | null) => (addressId ? { address_id: addressId } : {});

function fetchListings(
  regionId: string,
  { search, categoryId, sellerId, excludeProductId, limit, addressId }: ListFilters & Near
) {
  return storeClient.store.listings.query({
    region_id: regionId,
    ...near(addressId),
    ...(search ? { q: search } : {}),
    ...(categoryId ? { category_id: categoryId } : {}),
    ...(sellerId ? { seller_id: sellerId } : {}),
    ...(excludeProductId ? { exclude_product_id: excludeProductId } : {}),
    ...(limit ? { limit } : {}),
  });
}

async function fetchListing(regionId: string, sellerId: string, productId: string, addressId: string | null) {
  const { listing } = await storeClient.store.listings.$sellerId.$productId.query({
    $sellerId: sellerId,
    $productId: productId,
    region_id: regionId,
    ...near(addressId),
  });
  return listing;
}

export type Listing = Awaited<ReturnType<typeof fetchListings>>['listings'][number];
export type ListingDetail = Awaited<ReturnType<typeof fetchListing>>;

/**
 * Shop listings visible in the region, in the backend's order (best match, then nearest and
 * fastest shop from the address the buyer delivers to; never by price): the feed, search and
 * category results, or one shop's. Waits until it is known which address that is.
 */
export function useListings(regionId: string | undefined, filters: ListFilters = {}) {
  const addressId = useDeliveringToId();
  const measured = { ...filters, addressId: addressId ?? null };
  return useQuery({
    queryKey: listingKeys.list(regionId ?? '', measured),
    queryFn:
      regionId && addressId !== undefined ? async () => (await fetchListings(regionId, measured)).listings : skipToken,
  });
}

/**
 * How the listing's shop would deliver it to the signed-in buyer's saved address (#23), or null
 * when they have none: the product page then shows the shop's dispatch time. Guests aren't asked.
 * Keyed by buyer, so one buyer never sees another's estimate.
 */
export function useDeliveryEstimate(
  regionId: string | undefined,
  sellerId: string,
  productId: string,
  userId: string | null | undefined
) {
  return useQuery({
    queryKey: [...listingKeys.detail(regionId ?? '', sellerId, productId), 'delivery-estimate', { userId }] as const,
    queryFn:
      regionId && userId
        ? async () => {
            const { estimate } = await storeClient.store.listings.$sellerId.$productId.deliveryEstimate.query({
              $sellerId: sellerId,
              $productId: productId,
              region_id: regionId,
            });
            return estimate;
          }
        : skipToken,
    // Courier rates move slowly; a product page revisited within minutes reuses its estimate.
    staleTime: 5 * 60 * 1000,
  });
}

/** One shop's listing of a product, for the product page, with how far the shop is. */
export function useListing(regionId: string | undefined, sellerId: string, productId: string) {
  const addressId = useDeliveringToId();
  return useQuery({
    queryKey: [...listingKeys.detail(regionId ?? '', sellerId, productId), { addressId }] as const,
    queryFn:
      regionId && addressId !== undefined ? () => fetchListing(regionId, sellerId, productId, addressId) : skipToken,
    // The shop stopped selling it.
    retry: (failures, error) => !isNotFound(error) && failures < 1,
  });
}

