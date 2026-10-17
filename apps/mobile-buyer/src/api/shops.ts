import { skipToken, useQuery } from '@tanstack/react-query';

import { useDeliveringToId } from '@/delivering-to/delivering-to-provider';

import { storeClient } from './client';
import { isNotFound } from './errors';

export const shopKeys = {
  all: ['shops'] as const,
  detail: (regionId: string, sellerId: string) => [...shopKeys.all, 'detail', { regionId, sellerId }] as const,
};

async function fetchShop(regionId: string, sellerId: string, addressId: string | null) {
  const { shop } = await storeClient.store.shops.$sellerId.query({
    $sellerId: sellerId,
    region_id: regionId,
    ...(addressId ? { address_id: addressId } : {}),
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
    queryKey: [...shopKeys.detail(regionId ?? '', sellerId), { addressId }] as const,
    queryFn: regionId && addressId !== undefined ? () => fetchShop(regionId, sellerId, addressId) : skipToken,
    retry: (failures, error) => !isNotFound(error) && failures < 1,
  });
}
