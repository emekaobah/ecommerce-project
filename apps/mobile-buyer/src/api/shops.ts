import { measuredFrom, type MeasuredFrom } from '@oja/domain';
import { skipToken, useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { NOWHERE, useMeasuredFrom } from '@/delivering-to/delivering-to-provider';

import { storeClient } from './client';
import { isNotFound } from './errors';

/** Shops loaded per page of Home's "Near you" (the route allows up to 50). */
const PAGE_SIZE = 10;

export const shopKeys = {
  all: ['shops'] as const,
  near: (regionId: string, categoryId: string | null, { addressId, near }: MeasuredFrom) =>
    [...shopKeys.all, 'near', { regionId, categoryId, addressId, near }] as const,
  detail: (regionId: string, sellerId: string, { addressId, near }: MeasuredFrom) =>
    [...shopKeys.all, 'detail', { regionId, sellerId, addressId, near }] as const,
};

async function fetchShop(regionId: string, sellerId: string, from: MeasuredFrom) {
  const { shop } = await storeClient.store.shops.$sellerId.query({
    $sellerId: sellerId,
    region_id: regionId,
    ...measuredFrom(from),
  });
  return shop;
}

export type Shop = Awaited<ReturnType<typeof fetchShop>>;

/**
 * A shop page's header, with whether it is open (ADR 0004) and how far it is from the address
 * the buyer delivers to (#43), or a guest's spot (#109); not found when the shop isn't live or
 * doesn't serve the region.
 */
export function useShop(regionId: string | undefined, sellerId: string) {
  const from = useMeasuredFrom();
  return useQuery({
    queryKey: shopKeys.detail(regionId ?? '', sellerId, from ?? NOWHERE),
    queryFn: regionId && from ? () => fetchShop(regionId, sellerId, from) : skipToken,
    retry: (failures, error) => !isNotFound(error) && failures < 1,
  });
}

function fetchShops(regionId: string, categoryId: string | null, from: MeasuredFrom, offset: number) {
  return storeClient.store.shops.query({
    region_id: regionId,
    ...measuredFrom(from),
    ...(categoryId ? { category_id: categoryId } : {}),
    limit: PAGE_SIZE,
    offset,
  });
}

export type ShopsPage = Awaited<ReturnType<typeof fetchShops>>;
export type NearbyShop = ShopsPage['shops'][number];

/**
 * Home's shops near the buyer (#65), a page at a time as they scroll: each shop once with its
 * top listings, nearest first from the address they deliver to or a guest's spot, else in the
 * store's order; only shops selling in `categoryId` (a department) when given. Waits until it is
 * known where they're measured from.
 */
export function useShops(regionId: string | undefined, categoryId: string | null = null) {
  const from = useMeasuredFrom();
  return useInfiniteQuery({
    queryKey: shopKeys.near(regionId ?? '', categoryId, from ?? NOWHERE),
    queryFn: regionId && from ? ({ pageParam }) => fetchShops(regionId, categoryId, from, pageParam) : skipToken,
    initialPageParam: 0,
    getNextPageParam: (last: ShopsPage) => {
      const next = last.offset + last.shops.length;
      return next < last.count && last.shops.length ? next : undefined;
    },
  });
}
