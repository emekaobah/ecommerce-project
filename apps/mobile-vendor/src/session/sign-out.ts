import { queryClient } from '@/api/query-client';
import { forgetDevice } from '@/push/push-registration';

import { clearSession, getSession } from './session-store';

/**
 * Clears the stored credentials and every cached query, so the next member starts clean, and
 * stops this device getting the member's pushes.
 */
export async function signOut(): Promise<void> {
  queryClient.clear();
  // Leaves straight away; the device is removed in the background with the session as it was.
  void forgetDevice(getSession());
  await clearSession();
}
