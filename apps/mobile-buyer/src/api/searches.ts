import { skipToken, useQuery } from '@tanstack/react-query';

import { readSearchPhoneId } from '@/search/search-phone-id';

import { storeClient } from './client';

// Popular searches on the Search tab (#124): the searches buyers use are recorded with the
// phone's anonymous id, never the buyer's, and the backend publishes the popular ones hourly.

export const popularSearchKeys = {
  all: ['popular-searches'] as const,
  list: (regionId: string) => [...popularSearchKeys.all, { regionId }] as const,
};

/**
 * Records a search the buyer used: submitted, or a product opened from its results; never a
 * keystroke. Best effort: a search that isn't recorded only misses the popular list.
 */
export function recordSearch(regionId: string | undefined, term: string): void {
  const search = term.trim();
  if (!regionId || !search) return;
  void readSearchPhoneId()
    .then((phoneId) => storeClient.store.searches.mutate({ term: search, region_id: regionId, phone_id: phoneId }))
    .catch(() => {});
}

/** The region's popular searches, most popular first; empty until enough phones have searched. */
export function usePopularSearches(regionId: string | undefined) {
  return useQuery({
    queryKey: popularSearchKeys.list(regionId ?? ''),
    queryFn: regionId
      ? async () => (await storeClient.store.popularSearches.query({ region_id: regionId })).popular_searches
      : skipToken,
    // The list is published hourly.
    staleTime: 30 * 60 * 1000,
  });
}
