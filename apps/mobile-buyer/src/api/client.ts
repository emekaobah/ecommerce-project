import { getClerkInstance } from '@clerk/expo';
import { createStoreClient } from '@oja/api-client';

import { env } from '@/config/env';

/**
 * The Clerk session token, fetched per request (ADR 0001). `getToken` returns Clerk's cached
 * token and refreshes it before it expires; `fresh` skips the cache after the API rejected one.
 * Guests, and sessions with pending tasks, send none.
 */
async function clerkSessionToken({ fresh }: { fresh: boolean }): Promise<string | null> {
  const session = getClerkInstance().session;
  return session?.status === 'active' ? session.getToken({ skipCache: fresh }) : null;
}

export const storeClient = createStoreClient({
  baseUrl: env.apiUrl,
  publishableKey: env.publishableKey,
  getToken: clerkSessionToken,
  // Even a fresh token was rejected (e.g. the session was revoked): sign out, so the buyer
  // browses as a guest and can sign in again instead of every request failing.
  onUnauthorized: () => void getClerkInstance().signOut(),
});
