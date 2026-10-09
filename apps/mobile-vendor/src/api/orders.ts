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
 * minute while on screen, so a new order shows up before its accept deadline runs down even
 * on a device that gets no pushes; a push arriving refreshes it at once (#27).
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

/** A tap sets how many of a line are picked; a scan adds one, so scans from two phones both count. */
export type PickUpdate = { itemId: string } & ({ picked: number } | { add: number });

/**
 * Records a pick. The list shows the new count at once; if the server refuses it, the list is
 * read again rather than rolled back, so picks confirmed meanwhile stay.
 */
export function useRecordPick(orderId: string) {
  const queryClient = useQueryClient();
  const key = orderKeys.pickList(orderId);
  return useMutation({
    mutationFn: ({ itemId, ...pick }: PickUpdate) =>
      vendorClient.vendor.orders.$id.pickList.$itemId.mutate({ $id: orderId, $itemId: itemId, ...pick }),
    onMutate: async (pick) => {
      await queryClient.cancelQueries({ queryKey: key });
      const current = queryClient.getQueryData<PickList>(key);
      if (!current) return;
      const lines = current.lines.map((line) =>
        line.id === pick.itemId ? { ...line, picked: 'add' in pick ? line.picked + pick.add : pick.picked } : line,
      );
      queryClient.setQueryData<PickList>(key, { ...current, lines, progress: pickProgress(lines) });
    },
    onError: () => queryClient.invalidateQueries({ queryKey: key }),
    onSuccess: ({ pick_list }) => queryClient.setQueryData(key, pick_list),
  });
}

/**
 * Books a courier label for a packed order, paid by the platform; or rebooks one whose
 * shipment Shipbubble cancelled. The courier then confirms the pickup.
 */
export function useBookLabel(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => vendorClient.vendor.orders.$id.bookLabel.mutate({ $id: orderId }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
  });
}

/**
 * Confirms the parcel was handed to the courier (#25), recorded as this member's. The order is
 * handed over once Shipbubble reports the pickup too.
 */
export function useConfirmHandover(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => vendorClient.vendor.orders.$id.handOver.mutate({ $id: orderId }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
  });
}

/**
 * Sets how many of a line the shop doesn't have (#22); none clears it. The order is partially
 * available until they are removed. Answers the pick list, with what they would refund.
 */
export function useMarkUnavailable(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) =>
      vendorClient.vendor.orders.$id.pickList.$itemId.unavailable.mutate({ $id: orderId, $itemId: itemId, quantity }),
    onSuccess: ({ pick_list }) => queryClient.setQueryData(orderKeys.pickList(orderId), pick_list),
    // The order's state moves between picking and partially available.
    onSettled: () => queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) }),
  });
}

/**
 * Removes the items marked unavailable from the order and refunds the buyer what they cost;
 * the order goes back to picking.
 */
export function useRemoveUnavailable(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => vendorClient.vendor.orders.$id.removeUnavailable.mutate({ $id: orderId }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
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
