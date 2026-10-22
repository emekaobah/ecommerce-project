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
export type CheckoutPromotion = Checkout['promotions'][number];

/**
 * The cart as checkout shows it. `waitForOrder` polls until Paystack's webhook has confirmed
 * the payment and the cart has become an order group, or the cart failed to become orders and
 * was refunded (`not_placed`, #38).
 */
export function useCheckout(cartId: string | null | undefined, { waitForOrder = false } = {}) {
  return useQuery({
    queryKey: checkoutKeys.detail(cartId ?? ''),
    queryFn: cartId ? () => fetchCheckout(cartId) : skipToken,
    staleTime: 0,
    refetchInterval: (query) =>
      waitForOrder && !query.state.data?.order_group_id && !query.state.data?.not_placed ? 2_000 : false,
  });
}

/** The buyer's name and phone, when every shop's order is collected and no address is given. */
export type CheckoutContact = { first_name: string; last_name: string; phone: string };

/**
 * How each shop's order reaches the buyer: the shops in `pickup` are collected in store (#12),
 * the rest delivered to `shippingAddress`. With every shop collected, `contact` stands in for it.
 */
export type CheckoutPreparation = {
  shippingAddress?: PinnedDeliveryAddress | null;
  contact?: CheckoutContact | null;
  pickup: string[];
};

/**
 * Sets how each shop's order reaches the buyer: the delivery address, with its pin, and the
 * shops collected in store; the backend reprices the cart and adds each shop's delivery or
 * pickup. Resolves to the lines whose shop's price changed, for the buyer to see.
 */
export function usePrepareCheckout(cartId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shippingAddress, contact, pickup }: CheckoutPreparation) =>
      storeClient.store.carts.$id.checkout.mutate({
        $id: cartId,
        ...(shippingAddress ? { shipping_address: shippingAddress } : {}),
        ...(contact ? { contact } : {}),
        pickup,
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
 * Applies a promo code (#6). A code the buyer can't use is refused with why (expired, used up,
 * not for anything in the cart), as the error's message.
 */
export function useApplyPromoCode(cartId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      const { checkout } = await storeClient.store.carts.$id.checkout.promoCodes.mutate({ $id: cartId, code });
      return checkout;
    },
    onSuccess: (checkout) => queryClient.setQueryData(checkoutKeys.detail(cartId), checkout),
  });
}

/** Takes a promo code the buyer entered off the cart. */
export function useRemovePromoCode(cartId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      const { checkout } = await storeClient.store.carts.$id.checkout.promoCodes.$code.delete({ $id: cartId, $code: code });
      return checkout;
    },
    onSuccess: (checkout) => queryClient.setQueryData(checkoutKeys.detail(cartId), checkout),
  });
}

/**
 * Starts a Paystack payment; each call starts a fresh one, so it is also the retry. The backend
 * reprices the cart, cuts it to what its shops have left and works its promotions out again
 * first: when a shop's price changed or a line sold out, `payment` is null and `price_changes`
 * and `stock_changes` say what changed; when its discounts changed (a code
 * expired or was used up), `payment` is null and `discount_changed` is set. Either way the buyer
 * sees the new total before paying it.
 */
export function useStartPayment(cartId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (returnUrl: string) =>
      storeClient.store.carts.$id.checkout.payment.mutate({
        $id: cartId,
        return_url: returnUrl,
      }),
    onSuccess: ({ checkout, price_changes, stock_changes }) => {
      queryClient.setQueryData(checkoutKeys.detail(cartId), checkout);
      if (price_changes.length || stock_changes.length) void queryClient.invalidateQueries({ queryKey: cartKeys.all });
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
