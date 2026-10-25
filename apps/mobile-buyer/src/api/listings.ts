import { measuredFrom, type MeasuredFrom } from '@oja/domain';
import { skipToken, useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { NOWHERE, useDeliveringToId, useMeasuredFrom } from '@/delivering-to/delivering-to-provider';

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

/** Listings loaded per page of search and category results (the route allows up to 100). */
const PAGE_SIZE = 40;

export const listingKeys = {
  all: ['listings'] as const,
  list: (regionId: string, filters: ListFilters & MeasuredFrom) => [...listingKeys.all, 'list', { regionId, ...filters }] as const,
  pages: (regionId: string, filters: ListFilters & MeasuredFrom) => [...listingKeys.all, 'pages', { regionId, ...filters }] as const,
  detail: (regionId: string, sellerId: string, productId: string, { addressId, near }: MeasuredFrom) =>
    [...listingKeys.all, 'detail', { regionId, sellerId, productId, addressId, near }] as const,
  deliveryEstimate: (regionId: string, sellerId: string, productId: string, estimate: EstimateFor) =>
    [...listingKeys.all, 'delivery-estimate', { regionId, sellerId, productId, ...estimate }] as const,
};

function fetchListings(
  regionId: string,
  { search, categoryId, sellerId, excludeProductId, limit, ...from }: ListFilters & MeasuredFrom,
  offset = 0
) {
  return storeClient.store.listings.query({
    region_id: regionId,
    ...measuredFrom(from),
    ...(search ? { q: search } : {}),
    ...(categoryId ? { category_id: categoryId } : {}),
    ...(sellerId ? { seller_id: sellerId } : {}),
    ...(excludeProductId ? { exclude_product_id: excludeProductId } : {}),
    ...(limit ? { limit } : {}),
    ...(offset ? { offset } : {}),
  });
}

async function fetchListing(regionId: string, sellerId: string, productId: string, from: MeasuredFrom) {
  const { listing } = await storeClient.store.listings.$sellerId.$productId.query({
    $sellerId: sellerId,
    $productId: productId,
    region_id: regionId,
    ...measuredFrom(from),
  });
  return listing;
}

export type ListingPage = Awaited<ReturnType<typeof fetchListings>>;
export type Listing = ListingPage['listings'][number];
export type ListingDetail = Awaited<ReturnType<typeof fetchListing>>;

/**
 * Shop listings visible in the region, in the backend's order (best match, then nearest and
 * fastest shop from the address the buyer delivers to, or a guest's spot; never by price): the
 * feed, search and category results, or one shop's. Waits until it is known where that is.
 */
export function useListings(regionId: string | undefined, filters: ListFilters = {}) {
  const from = useMeasuredFrom();
  const measured = { ...filters, ...NOWHERE, ...from };
  return useQuery({
    queryKey: listingKeys.list(regionId ?? '', measured),
    queryFn: regionId && from ? async () => (await fetchListings(regionId, measured)).listings : skipToken,
  });
}

/**
 * Search and category results a page at a time, with the true totals across every page: how many
 * listings match and from how many shops ("2 shops · 5 products"). Waits for where they're
 * measured from like `useListings`.
 */
export function useListingResults(regionId: string | undefined, filters: Omit<ListFilters, 'limit'>) {
  const from = useMeasuredFrom();
  const measured = { ...filters, limit: PAGE_SIZE, ...NOWHERE, ...from };
  return useInfiniteQuery({
    queryKey: listingKeys.pages(regionId ?? '', measured),
    queryFn: regionId && from ? ({ pageParam }) => fetchListings(regionId, measured, pageParam) : skipToken,
    initialPageParam: 0,
    getNextPageParam: (last: ListingPage) => {
      const next = last.offset + last.listings.length;
      return next < last.count && last.listings.length ? next : undefined;
    },
  });
}

/** What a delivery estimate is for: the buyer, the address they deliver to and the size they chose. */
type EstimateFor = { userId: string | null | undefined; addressId: string | null | undefined; variantId: string | undefined };

/**
 * How the listing's shop would deliver the chosen size to the address in "Delivering to" (#23):
 * its best-value courier's date and fee, or null without a saved address, when the page shows the
 * shop's dispatch time instead. Guests aren't asked. Keyed by buyer, address and variant, so the
 * estimate follows each.
 */
export function useDeliveryEstimate(
  regionId: string | undefined,
  sellerId: string,
  productId: string,
  { userId, variantId }: { userId: string | null | undefined; variantId: string | undefined }
) {
  const addressId = useDeliveringToId();
  const estimateFor = { userId, addressId, variantId };
  return useQuery({
    queryKey: listingKeys.deliveryEstimate(regionId ?? '', sellerId, productId, estimateFor),
    queryFn:
      regionId && userId && addressId
        ? async () => {
            const { estimate } = await storeClient.store.listings.$sellerId.$productId.deliveryEstimate.query({
              $sellerId: sellerId,
              $productId: productId,
              region_id: regionId,
              address_id: addressId,
              ...(variantId ? { variant_id: variantId } : {}),
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
  const from = useMeasuredFrom();
  return useQuery({
    queryKey: listingKeys.detail(regionId ?? '', sellerId, productId, from ?? NOWHERE),
    queryFn: regionId && from ? () => fetchListing(regionId, sellerId, productId, from) : skipToken,
    // The shop stopped selling it.
    retry: (failures, error) => !isNotFound(error) && failures < 1,
  });
}

