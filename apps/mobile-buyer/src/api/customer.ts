import type { ReceiverName } from '@oja/domain';
import { skipToken, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

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

/**
 * Puts the buyer's name on their account. Checkout asks for it when neither the delivery
 * address nor the account has one (#101), and keeps it so it doesn't ask again.
 */
export function useSaveAccountName(userId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: ReceiverName) => storeClient.store.customers.me.mutate(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: customerKeys.me(userId ?? '') }),
  });
}

export const summaryKeys = {
  all: ['account-summary'] as const,
  /** Keyed by Clerk user, like the profile. */
  me: (userId: string) => [...summaryKeys.all, { userId }] as const,
};

async function fetchAccountSummary() {
  const { summary } = await storeClient.store.customers.me.summary.query();
  return summary;
}

export type AccountSummary = Awaited<ReturnType<typeof fetchAccountSummary>>;

/** The counts on the Account screen (#73): saved items, reviews, orders to review and addresses, in one request. */
export function useAccountSummary(userId: string | null | undefined) {
  return useQuery({
    queryKey: summaryKeys.me(userId ?? ''),
    queryFn: userId ? fetchAccountSummary : skipToken,
  });
}

/**
 * Refreshes the Account counts after a write, without holding the write up: it's done whether or
 * not the counts come back. A summary fetch already in flight started before the write, so it's
 * cancelled rather than reused, which would keep the old counts.
 */
export function refreshAccountSummary(queryClient: QueryClient) {
  void queryClient
    .cancelQueries({ queryKey: summaryKeys.all })
    .then(() => queryClient.invalidateQueries({ queryKey: summaryKeys.all }));
}
