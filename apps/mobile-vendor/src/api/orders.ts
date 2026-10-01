import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { vendorClient } from './client';

export const orderKeys = {
  all: ['orders'] as const,
  list: (sellerId: string) => [...orderKeys.all, 'list', { sellerId }] as const,
  detail: (orderId: string) => [...orderKeys.all, 'detail', orderId] as const,
};

// The default fields leave out the order total; `+` adds it to them.
const ORDER_FIELDS = '+total,+credit_line_total,+created_at,+items.product_title,+items.quantity';

/**
 * What the buyer paid for the order. A refund adds a credit line that takes the refunded
 * amount off the order's `total` (what is still owed), so a refunded order's total is 0.
 */
export const orderValue = (order: { total: unknown; credit_line_total?: unknown }) =>
  Number(order.total) + Number(order.credit_line_total ?? 0);

const acceptOrder = (orderId: string) => vendorClient.vendor.orders.$id.accept.mutate({ $id: orderId });

/** Where an order is in fulfilment, and while it is new, when it must be accepted by. */
export type OrderFulfilment = Awaited<ReturnType<typeof acceptOrder>>['fulfilment'];

// The API adds each order's fulfilment to Mercur's order responses, which its types don't know.
type WithFulfilment<T> = T & { fulfilment: OrderFulfilment };

async function fetchOrders() {
  const { orders } = await vendorClient.vendor.orders.query({ limit: 50, order: '-created_at', fields: ORDER_FIELDS });
  return orders as WithFulfilment<(typeof orders)[number]>[];
}

async function fetchOrder(orderId: string) {
  const { order } = await vendorClient.vendor.orders.$id.query({ $id: orderId, fields: ORDER_FIELDS });
  return order as WithFulfilment<typeof order>;
}

export type Order = Awaited<ReturnType<typeof fetchOrder>>;

/**
 * The shop's orders, newest first. Waits while there is no session. Checked again every
 * minute while on screen, so a new order shows up before its accept deadline runs down
 * (until push notifications, #27).
 */
export function useOrders(sellerId: string | undefined) {
  return useQuery({
    queryKey: orderKeys.list(sellerId ?? ''),
    queryFn: sellerId ? fetchOrders : skipToken,
    refetchInterval: 60_000,
  });
}

/** One of the shop's orders. */
export function useOrder(orderId: string) {
  return useQuery({ queryKey: orderKeys.detail(orderId), queryFn: () => fetchOrder(orderId) });
}

/** Accepts a new order; the shop then picks and packs it. */
export function useAcceptOrder(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => acceptOrder(orderId),
    // Refused orders refresh too: someone else, or the deadline, may have moved it on.
    onSettled: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
  });
}

/** Rejects a new order with the reason the buyer is told; the buyer is refunded. */
export function useRejectOrder(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => vendorClient.vendor.orders.$id.reject.mutate({ $id: orderId, reason }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
  });
}
