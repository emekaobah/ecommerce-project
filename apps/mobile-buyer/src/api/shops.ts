import { skipToken, useQuery } from '@tanstack/react-query';

import { storeClient } from './client';
import { isNotFound } from './errors';

export const shopKeys = {
  all: ['shops'] as const,
  detail: (regionId: string, sellerId: string) => [...shopKeys.all, 'detail', { regionId, sellerId }] as const,
};

async function fetchShop(regionId: string, sellerId: string) {
  const { shop } = await storeClient.store.shops.$sellerId.query({ $sellerId: sellerId, region_id: regionId });
  return shop;
}

export type Shop = Awaited<ReturnType<typeof fetchShop>>;

/** A shop page's header; not found when the shop is closed or doesn't serve the region. */
export function useShop(regionId: string | undefined, sellerId: string) {
  return useQuery({
    queryKey: shopKeys.detail(regionId ?? '', sellerId),
    queryFn: regionId ? () => fetchShop(regionId, sellerId) : skipToken,
    retry: (failures, error) => !isNotFound(error) && failures < 1,
  });
}
