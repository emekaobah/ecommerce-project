import { skipToken, useQuery } from '@tanstack/react-query';

import { storeClient } from './client';

export const customerKeys = {
  all: ['customer'] as const,
  /** Keyed by Clerk user so one buyer never sees another's cached profile. */
  me: (userId: string) => [...customerKeys.all, 'me', { userId }] as const,
};

async function fetchCustomer() {
  const { customer } = await storeClient.store.customers.me.query();
  return customer;
}

export type Customer = Awaited<ReturnType<typeof fetchCustomer>>;

/** The signed-in buyer's Medusa customer, created by the backend on first sign-in. */
export function useCustomer(userId: string | null | undefined) {
  return useQuery({
    queryKey: customerKeys.me(userId ?? ''),
    queryFn: userId ? fetchCustomer : skipToken,
  });
}
