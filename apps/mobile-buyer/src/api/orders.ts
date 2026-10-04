import { skipToken, useQuery } from '@tanstack/react-query';

import { storeClient } from './client';

export const orderKeys = {
  all: ['orders'] as const,
  /** Keyed by Clerk user so one buyer never sees another's cached orders. */
  list: (userId: string) => [...orderKeys.all, 'list', { userId }] as const,
  group: (userId: string, groupId: string) => [...orderKeys.all, 'group', { userId, groupId }] as const,
};

/** How many order groups the list shows; older ones wait for paging (not needed yet). */
const HISTORY_LIMIT = 50;

async function fetchOrderHistory() {
  const { order_groups } = await storeClient.store.orderHistory.query({ limit: HISTORY_LIMIT });
  return order_groups;
}

async function fetchOrderGroup(groupId: string) {
  const { order_group } = await storeClient.store.orderHistory.$id.query({ $id: groupId });
  return order_group;
}

/** A checkout: the shops' orders it was split into. */
export type OrderGroup = Awaited<ReturnType<typeof fetchOrderGroup>>;
/** One shop's order of a checkout, with its state, what was paid and any refund. */
export type SellerOrder = OrderGroup['orders'][number];

/**
 * The signed-in buyer's order groups, newest first. Idle for guests. Checked again every minute
 * while on screen, so a shop accepting or rejecting an order shows up (until push, #28).
 */
export function useOrderHistory(userId: string | null | undefined) {
  return useQuery({
    queryKey: orderKeys.list(userId ?? ''),
    queryFn: userId ? fetchOrderHistory : skipToken,
    refetchInterval: 60_000,
  });
}

/** One of the buyer's order groups. */
export function useOrderGroup(userId: string | null | undefined, groupId: string) {
  return useQuery({
    queryKey: orderKeys.group(userId ?? '', groupId),
    queryFn: userId ? () => fetchOrderGroup(groupId) : skipToken,
    refetchInterval: 60_000,
  });
}
