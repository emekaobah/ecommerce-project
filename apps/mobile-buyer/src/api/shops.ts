import { skipToken, useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { useDeliveringToId } from '@/delivering-to/delivering-to-provider';

import { storeClient } from './client';
import { isNotFound } from './errors';
import { near, type Near } from './listings';

/** Shops loaded per page of Home's "Near you" (the route allows up to 50). */
const PAGE_SIZE = 10;

export const shopKeys = {
  all: ['shops'] as const,
  near: (regionId: string, categoryId: string | null, { addressId }: Near) =>
    [...shopKeys.all, 'near', { regionId, categoryId, addressId }] as const,
  detail: (regionId: string, sellerId: string, { addressId }: Near) =>
    [...shopKeys.all, 'detail', { regionId, sellerId, addressId }] as const,
};

async function fetchShop(regionId: string, sellerId: string, addressId: string | null) {
  const { shop } = await storeClient.store.shops.$sellerId.query({
    $sellerId: sellerId,
    region_id: regionId,
    ...near(addressId),
  });
  return shop;
}

export type Shop = Awaited<ReturnType<typeof fetchShop>>;

/**
 * A shop page's header, with whether it is open (ADR 0004) and how far it is from the address
 * the buyer delivers to (#43); not found when the shop isn't live or doesn't serve the region.
 */
export function useShop(regionId: string | undefined, sellerId: string) {
  const addressId = useDeliveringToId();
  return useQuery({
    queryKey: shopKeys.detail(regionId ?? '', sellerId, { addressId: addressId ?? null }),
    queryFn: regionId && addressId !== undefined ? () => fetchShop(regionId, sellerId, addressId) : skipToken,
    retry: (failures, error) => !isNotFound(error) && failures < 1,
  });
}

function fetchShops(regionId: string, categoryId: string | null, addressId: string | null, offset: number) {
  return storeClient.store.shops.query({
    region_id: regionId,
    ...near(addressId),
    ...(categoryId ? { category_id: categoryId } : {}),
    limit: PAGE_SIZE,
    offset,
  });
}

export type ShopsPage = Awaited<ReturnType<typeof fetchShops>>;
export type NearbyShop = ShopsPage['shops'][number];

/**
 * Home's shops near the buyer (#65), a page at a time as they scroll: each shop once with its
 * top listings, nearest first from the address they deliver to, else in the store's order; only
 * shops selling in `categoryId` (a department) when given. Waits until it is known which address
 * that is.
 */
export function useShops(regionId: string | undefined, categoryId: string | null = null) {
  const addressId = useDeliveringToId();
  return useInfiniteQuery({
    queryKey: shopKeys.near(regionId ?? '', categoryId, { addressId: addressId ?? null }),
    queryFn:
      regionId && addressId !== undefined
        ? ({ pageParam }) => fetchShops(regionId, categoryId, addressId, pageParam)
        : skipToken,
    initialPageParam: 0,
    getNextPageParam: (last: ShopsPage) => {
      const next = last.offset + last.shops.length;
      return next < last.count && last.shops.length ? next : undefined;
    },
  });
}
