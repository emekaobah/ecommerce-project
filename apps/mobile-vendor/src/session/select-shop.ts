import { queryClient } from '@/api/query-client';

import { getToken, saveSession } from './session-store';

/**
 * Acts for another of the member's shops, and persists it for the next launch.
 * Every cached query belonged to the previous shop, so the cache is emptied.
 */
export async function selectShop(sellerId: string): Promise<void> {
  const token = getToken();
  if (!token) return;
  queryClient.clear();
  await saveSession({ token, sellerId });
}
