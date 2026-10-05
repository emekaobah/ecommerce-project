import { pickProgress } from '@oja/domain';
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { vendorClient } from './client';

export const orderKeys = {
  all: ['orders'] as const,
  list: (sellerId: string) => [...orderKeys.all, 'list', { sellerId }] as const,
  detail: (orderId: string) => [...orderKeys.all, 'detail', orderId] as const,
  pickList: (orderId: string) => [...orderKeys.all, 'pick-list', orderId] as const,
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

/** Starts picking an accepted order; staff then work through its pick list. */
export function useStartPicking(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => vendorClient.vendor.orders.$id.startPicking.mutate({ $id: orderId }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
  });
}

const fetchPickList = async (orderId: string) =>
  (await vendorClient.vendor.orders.$id.pickList.query({ $id: orderId })).pick_list;

export type PickList = Awaited<ReturnType<typeof fetchPickList>>;
export type PickListLine = PickList['lines'][number];

/**
 * The order's pick list: each line, how many to pick and how many are picked. Progress is
 * kept on the server, so it is the same after leaving the screen or on another phone.
 */
export function usePickList(orderId: string) {
  return useQuery({ queryKey: orderKeys.pickList(orderId), queryFn: () => fetchPickList(orderId) });
}

/**
 * Sets how many of a line are picked. The list shows the new count at once, and goes back if
 * the server refuses it.
 */
export function useRecordPick(orderId: string) {
  const queryClient = useQueryClient();
  const key = orderKeys.pickList(orderId);
  return useMutation({
    mutationFn: ({ itemId, picked }: { itemId: string; picked: number }) =>
      vendorClient.vendor.orders.$id.pickList.$itemId.mutate({ $id: orderId, $itemId: itemId, picked }),
    onMutate: async ({ itemId, picked }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PickList>(key);
      if (previous) {
        const lines = previous.lines.map((line) => (line.id === itemId ? { ...line, picked } : line));
        queryClient.setQueryData<PickList>(key, { lines, progress: pickProgress(lines) });
      }
      return { previous };
    },
    onError: (_error, _pick, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: ({ pick_list }) => queryClient.setQueryData(key, pick_list),
  });
}

/** Marks a fully picked order packed, ready for a courier label. */
export function usePackOrder(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => vendorClient.vendor.orders.$id.pack.mutate({ $id: orderId }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
  });
}
