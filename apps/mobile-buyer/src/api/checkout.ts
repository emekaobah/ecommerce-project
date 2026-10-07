import type { PinnedDeliveryAddress } from '@oja/domain';
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { cartKeys } from './cart';
import { storeClient } from './client';

export const checkoutKeys = {
  all: ['checkout'] as const,
  detail: (cartId: string) => [...checkoutKeys.all, cartId] as const,
  orderGroup: (orderGroupId: string) => [...checkoutKeys.all, 'order-group', orderGroupId] as const,
};

async function fetchCheckout(cartId: string) {
  const { checkout } = await storeClient.store.carts.$id.checkout.query({ $id: cartId });
  return checkout;
}

export type Checkout = Awaited<ReturnType<typeof fetchCheckout>>;
export type CheckoutSellerGroup = Checkout['sellers'][number];

/**
 * The cart as checkout shows it. `waitForOrder` polls until Paystack's webhook has confirmed
 * the payment and the cart has become an order group.
 */
export function useCheckout(cartId: string | null | undefined, { waitForOrder = false } = {}) {
  return useQuery({
    queryKey: checkoutKeys.detail(cartId ?? ''),
    queryFn: cartId ? () => fetchCheckout(cartId) : skipToken,
    staleTime: 0,
    refetchInterval: (query) => (waitForOrder && !query.state.data?.order_group_id ? 2_000 : false),
  });
}

/**
 * Sets the delivery address, with its pin; the backend reprices the cart and adds each shop's
 * delivery. Resolves to the lines whose shop's price changed, for the buyer to see.
 */
export function usePrepareCheckout(cartId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (shippingAddress: PinnedDeliveryAddress) =>
      storeClient.store.carts.$id.checkout.mutate({
        $id: cartId,
        shipping_address: shippingAddress,
      }),
    onSuccess: ({ checkout }) => queryClient.setQueryData(checkoutKeys.detail(cartId), checkout),
    // Repricing may have changed the cart's lines.
    onSettled: () => queryClient.invalidateQueries({ queryKey: cartKeys.all }),
  });
}

/** Picks one shop's delivery from the choices checkout quoted it (best value, cheapest, fastest). */
export function useChooseDelivery(cartId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sellerId, choiceId }: { sellerId: string; choiceId: string }) => {
      const { checkout } = await storeClient.store.carts.$id.checkout.delivery.mutate({
        $id: cartId,
        seller_id: sellerId,
        choice_id: choiceId,
      });
      return checkout;
    },
    onSuccess: (checkout) => queryClient.setQueryData(checkoutKeys.detail(cartId), checkout),
  });
}

/**
 * Starts a Paystack payment; each call starts a fresh one, so it is also the retry. The backend
 * reprices the cart first: when a shop's price changed, `payment` is null and `price_changes`
 * says what changed, for the buyer to see before paying the new total.
 */
export function useStartPayment(cartId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (returnUrl: string) =>
      storeClient.store.carts.$id.checkout.payment.mutate({
        $id: cartId,
        return_url: returnUrl,
      }),
    onSuccess: ({ checkout, price_changes }) => {
      queryClient.setQueryData(checkoutKeys.detail(cartId), checkout);
      if (price_changes.length) void queryClient.invalidateQueries({ queryKey: cartKeys.all });
    },
  });
}

// Mercur's default order-group fields nest deeper than the store allows (3 relations).
const ORDER_GROUP_FIELDS = [
  'id',
  'display_id',
  'total',
  'orders.id',
  'orders.display_id',
  'orders.currency_code',
  'orders.total',
  'orders.seller.name',
  'orders.items.id',
  'orders.items.product_title',
  'orders.items.quantity',
].join(',');

/** The order group a paid checkout became, in the `ORDER_GROUP_FIELDS` it is fetched with. */
export type OrderGroup = {
  id: string;
  display_id: number;
  total: number;
  orders: {
    id: string;
    display_id: number;
    currency_code: string;
    total: number;
    seller: { name: string } | null;
    items: { id: string; product_title: string | null; quantity: number }[];
  }[];
};

/** The order group a paid checkout became: one order per shop. */
export function useOrderGroup(orderGroupId: string | null | undefined) {
  return useQuery({
    queryKey: checkoutKeys.orderGroup(orderGroupId ?? ''),
    queryFn: orderGroupId
      ? async () => {
          const { order_group } = await storeClient.store.orderGroups.$id.query({
            $id: orderGroupId,
            fields: ORDER_GROUP_FIELDS,
          });
          // The route's type is the bare order group; the fields asked for add its orders.
          return order_group as unknown as OrderGroup;
        }
      : skipToken,
  });
}
