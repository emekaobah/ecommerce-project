import { listStoreProducts } from '@oja/api-client';
import { useQuery } from '@tanstack/react-query';

import { storeClient } from './client';

export const productKeys = {
  all: ['products'] as const,
  list: (regionId: string) => [...productKeys.all, 'list', { regionId }] as const,
};

/** Catalogue products priced for a region. Waits until a region is resolved. */
export function useProducts(regionId: string | undefined) {
  return useQuery({
    queryKey: productKeys.list(regionId ?? ''),
    queryFn: async () => (await listStoreProducts(storeClient, { regionId: regionId! })).products,
    enabled: !!regionId,
  });
}
