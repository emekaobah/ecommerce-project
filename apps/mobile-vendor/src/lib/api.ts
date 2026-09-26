import { createVendorClient } from '@oja/api-client';

export const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:9000';

// Held in memory for now; SecureStore persistence and sign-out on 401 arrive with the auth slice.
let session: { token: string; sellerId?: string } | null = null;

export function setSession(next: typeof session) {
  session = next;
}

/** One client for the app's lifetime; it reads the current session on every request. */
export const vendorClient = createVendorClient({
  baseUrl: apiUrl,
  getToken: () => session?.token,
  getSellerId: () => session?.sellerId,
});
