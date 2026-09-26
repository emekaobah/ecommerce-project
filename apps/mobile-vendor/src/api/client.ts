import { createVendorClient } from '@oja/api-client';

import { env } from '@/config/env';
import { getSession } from '@/session/session-store';
import { signOut } from '@/session/sign-out';

/** One client for the app's lifetime; it reads the current session on every request. */
export const vendorClient = createVendorClient({
  baseUrl: env.apiUrl,
  getToken: () => getSession()?.token,
  getSellerId: () => getSession()?.sellerId,
  // The member JWT expired or was revoked.
  onUnauthorized: () => void signOut(),
});
