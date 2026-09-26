import { createStoreClient } from '@oja/api-client';

export const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:9000';

export const storeClient = createStoreClient({
  baseUrl: apiUrl,
  publishableKey: process.env.EXPO_PUBLIC_PUBLISHABLE_KEY ?? '',
});
