import { queryClient } from '@/api/query-client';

import { clearSession } from './session-store';

/** Clears the stored credentials and every cached query, so the next member starts clean. */
export async function signOut(): Promise<void> {
  queryClient.clear();
  await clearSession();
}
