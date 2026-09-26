import { createStoreClient } from '@oja/api-client';

import { env } from '@/config/env';

// Guest-only until Clerk lands; it will pass `getToken` here.
export const storeClient = createStoreClient({
  baseUrl: env.apiUrl,
  publishableKey: env.publishableKey,
});
