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
      ? async () =>
          // The list's default fields leave out the order total; `+` adds it to them.
          (await vendorClient.vendor.orders.query({ limit: 50, order: '-created_at', fields: '+total' })).orders
      : skipToken,
  });
}
