import { getClerkInstance } from '@clerk/expo';
import { createStoreClient } from '@oja/api-client';

import { env } from '@/config/env';

/**
 * The Clerk session token, fetched per request (ADR 0001). `getToken` returns Clerk's cached
 * token and refreshes it before it expires. Guests, and sessions with pending tasks, send none.
 */
async function clerkSessionToken(): Promise<string | null> {
  const session = getClerkInstance().session;
  return session?.status === 'active' ? session.getToken() : null;
}

export const storeClient = createStoreClient({
  baseUrl: env.apiUrl,
  publishableKey: env.publishableKey,
  getToken: clerkSessionToken,
});
