import { useQuery } from '@tanstack/react-query';

import { storeClient } from './client';

export const regionKeys = {
  all: ['regions'] as const,
};

async function fetchRegions() {
  const { regions } = await storeClient.store.regions.query({ fields: '*countries' });
  return regions;
}

export type Region = Awaited<ReturnType<typeof fetchRegions>>[number];

export function useRegions() {
  return useQuery({ queryKey: regionKeys.all, queryFn: fetchRegions, staleTime: Infinity });
}
