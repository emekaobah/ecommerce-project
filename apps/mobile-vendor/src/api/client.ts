import { createVendorClient } from '@oja/api-client';

import { env } from '@/config/env';
import { getSession, getToken } from '@/session/session-store';
import { signOut } from '@/session/sign-out';

/** One client for the app's lifetime; it reads the current session on every request. */
export const vendorClient = createVendorClient({
  baseUrl: env.apiUrl,
  // The token alone lists the member's shops for the picker, before one is chosen.
  getToken,
  getSellerId: () => getSession()?.sellerId,
  // The member JWT expired or was revoked.
  onUnauthorized: () => void signOut(),
});
