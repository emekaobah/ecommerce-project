import { skipToken, useQuery } from '@tanstack/react-query';

import { vendorClient } from './client';

export const orderKeys = {
  all: ['orders'] as const,
  list: (sellerId: string) => [...orderKeys.all, 'list', { sellerId }] as const,
};

/** The shop's orders, newest first. Waits while there is no session. */
export function useOrders(sellerId: string | undefined) {
  return useQuery({
    queryKey: orderKeys.list(sellerId ?? ''),
    queryFn: sellerId
      ? async () => (await vendorClient.vendor.orders.query({ limit: 50, order: '-created_at' })).orders
      : skipToken,
  });
}
