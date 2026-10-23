import type { OrderPhase } from '@oja/domain';
import { skipToken, useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';

import { storeClient } from './client';

export const orderKeys = {
  all: ['orders'] as const,
  /** Keyed by Clerk user so one buyer never sees another's cached orders. */
  phase: (userId: string, phase: OrderPhase) => [...orderKeys.all, 'phase', { userId, phase }] as const,
  search: (userId: string, q: string) => [...orderKeys.all, 'search', { userId, q }] as const,
  group: (userId: string, groupId: string) => [...orderKeys.all, 'group', { userId, groupId }] as const,
  orderAgain: (userId: string, groupId: string, sellerId: string) =>
    [...orderKeys.all, 'order-again', { userId, groupId, sellerId }] as const,
};

/** How many past or found checkouts load at a time as the buyer scrolls. */
const PAGE_SIZE = 20;

/** Every minute while on screen, so a shop accepting or rejecting an order shows up (until push, #28). */
const REFETCH_MS = 60_000;

type HistoryQuery = { phase?: OrderPhase; q?: string; limit?: number; offset?: number };

function fetchOrderHistory(query: HistoryQuery) {
  return storeClient.store.orderHistory.query(query);
}

async function fetchOrderGroup(groupId: string) {
  const { order_group } = await storeClient.store.orderHistory.$id.query({ $id: groupId });
  return order_group;
}

type HistoryPage = Awaited<ReturnType<typeof fetchOrderHistory>>;

/** A checkout: the shops' orders it was split into. */
export type OrderGroup = Awaited<ReturnType<typeof fetchOrderGroup>>;
/** One shop's order of a checkout, with its state, what was paid and any refund. */
export type SellerOrder = OrderGroup['orders'][number];

const nextOffset = (last: HistoryPage) => {
  const next = last.offset + last.order_groups.length;
  return next < last.count ? next : undefined;
};

/**
 * The signed-in buyer's checkouts still happening, newest first: all of them, since the
 * server doesn't page this phase (#54). Idle for guests.
 */
export function useOrdersInProgress(userId: string | null | undefined) {
  return useQuery({
    queryKey: orderKeys.phase(userId ?? '', 'in_progress'),
    queryFn: userId ? async () => (await fetchOrderHistory({ phase: 'in_progress' })).order_groups : skipToken,
    refetchInterval: REFETCH_MS,
  });
}

/** The signed-in buyer's finished checkouts, newest first, a page at a time as they scroll. */
export function usePastOrders(userId: string | null | undefined) {
  return useInfiniteQuery({
    queryKey: orderKeys.phase(userId ?? '', 'past'),
    queryFn: userId
      ? ({ pageParam }) => fetchOrderHistory({ phase: 'past', limit: PAGE_SIZE, offset: pageParam })
      : skipToken,
    initialPageParam: 0,
    getNextPageParam: nextOffset,
    refetchInterval: REFETCH_MS,
  });
}

/** The buyer's checkouts with an item whose name matches `q`, in progress or past, newest first; idle without one. */
export function useOrderSearch(userId: string | null | undefined, q: string) {
  return useInfiniteQuery({
    queryKey: orderKeys.search(userId ?? '', q),
    queryFn:
      userId && q
        ? ({ pageParam }) => fetchOrderHistory({ q, limit: PAGE_SIZE, offset: pageParam })
        : skipToken,
    initialPageParam: 0,
    getNextPageParam: nextOffset,
  });
}

/** One of the buyer's order groups. */
export function useOrderGroup(userId: string | null | undefined, groupId: string) {
  return useQuery({
    queryKey: orderKeys.group(userId ?? '', groupId),
    queryFn: userId ? () => fetchOrderGroup(groupId) : skipToken,
    refetchInterval: REFETCH_MS,
  });
}

async function fetchOrderAgain(groupId: string, sellerId: string) {
  const { order_again } = await storeClient.store.orderHistory.$id.orderAgain.query({ $id: groupId, seller_id: sellerId });
  return order_again;
}

/** Order again's preview of one shop's part of a received order: each line at today's price and stock, and whether the shop takes orders. */
export type OrderAgain = Awaited<ReturnType<typeof fetchOrderAgain>>;

/**
 * Order again (#86): what reordering each shop's part of a checkout the buyer received would add,
 * one preview per shop, fetched while the sheet is open and fresh each time it opens. `data`
 * holds every shop's preview once all have come; `error` is the first failure.
 */
export function useOrderAgain(userId: string | null | undefined, groupId: string, sellerIds: readonly string[]) {
  return useQueries({
    queries: sellerIds.map((sellerId) => ({
      queryKey: orderKeys.orderAgain(userId ?? '', groupId, sellerId),
      queryFn: userId ? () => fetchOrderAgain(groupId, sellerId) : skipToken,
      staleTime: 0,
    })),
    combine: (results) => {
      const data = results.flatMap((result) => (result.data ? [result.data] : []));
      return {
        data: data.length === results.length ? data : undefined,
        error: results.find((result) => result.error)?.error ?? null,
        refetch: () => results.forEach((result) => void result.refetch()),
      };
    },
  });
}
