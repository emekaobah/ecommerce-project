import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { storeClient } from './client';
import { isNotFound } from './errors';

export const cartKeys = {
  all: ['cart'] as const,
  detail: (cartId: string) => [...cartKeys.all, cartId] as const,
};

export async function fetchCart(cartId: string) {
  const { cart } = await storeClient.store.carts.$id.sellers.query({ $id: cartId });
  return cart;
}

export async function createCart(regionId: string) {
  const { cart } = await storeClient.store.carts.mutate({ region_id: regionId });
  return cart.id;
}

/** Hands a guest's cart to the signed-in buyer; the request carries their session token. */
export async function transferCart(cartId: string) {
  await storeClient.store.carts.$id.customer.mutate({ $id: cartId });
}

/** Adds another cart's lines (the guest's) to the signed-in buyer's own cart. */
export async function mergeCart(cartId: string, fromCartId: string) {
  await storeClient.store.carts.$id.merge.mutate({ $id: cartId, cart_id: fromCartId });
}

/** The cart grouped by shop, or null when the store no longer has it. */
export async function fetchCartIfAny(cartId: string) {
  return fetchCart(cartId).catch((error: unknown) => {
    if (isNotFound(error)) return null;
    throw error;
  });
}

/** Every cart write changes the totals, so the cart is refetched however it went. */
function useRefetchCartAfterWrite() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: cartKeys.all });
}

export type Cart = Awaited<ReturnType<typeof fetchCart>>;
export type CartSellerGroup = Cart['sellers'][number];
export type CartItem = CartSellerGroup['items'][number];

/** The buyer's cart grouped by shop. Idle while there is no cart yet (nothing added). */
export function useCart(cartId: string | null | undefined) {
  return useQuery({
    queryKey: cartKeys.detail(cartId ?? ''),
    queryFn: cartId ? () => fetchCart(cartId) : skipToken,
    retry: (failures, error) => !isNotFound(error) && failures < 1,
  });
}

/** Adds a shop's offer to the cart `cartIdForAdding` resolves, which starts one on the first add. */
export function useAddToCart(cartIdForAdding: () => Promise<string>) {
  const onSettled = useRefetchCartAfterWrite();
  return useMutation({
    mutationFn: async ({ offerId, quantity = 1 }: { offerId: string; quantity?: number }) => {
      const cartId = await cartIdForAdding();
      await storeClient.store.carts.$id.lineItems.mutate({ $id: cartId, offer_id: offerId, quantity });
    },
    onSettled,
  });
}

/**
 * "Pay for this shop only" (#11): moves the shop's items to a shop cart, which resolves to be
 * checked out on its own. The cart keeps the other shops' items.
 */
export function useMoveShopToOwnCart(cartId: string) {
  const onSettled = useRefetchCartAfterWrite();
  return useMutation({
    mutationFn: async (sellerId: string) => {
      const { cart } = await storeClient.store.carts.$id.shopCart.mutate({ $id: cartId, seller_id: sellerId });
      return cart;
    },
    onSettled,
  });
}

/**
 * The buyer went back from a shop cart's checkout without paying (#11): its items and codes
 * return to the app's cart, and its Paystack page no longer places an order.
 */
export async function moveShopCartBack(cartId: string, shopCartId: string) {
  await storeClient.store.carts.$id.shopCart.back.mutate({ $id: cartId, shop_cart_id: shopCartId });
}

/** Sets a line's quantity; 0 removes it. */
export function useSetCartItemQuantity(cartId: string) {
  const onSettled = useRefetchCartAfterWrite();
  return useMutation({
    mutationFn: async ({ itemId, quantity }: { itemId: string; quantity: number }) => {
      if (quantity === 0) {
        await storeClient.store.carts.$id.lineItems.$lineId.delete({ $id: cartId, $lineId: itemId });
      } else {
        await storeClient.store.carts.$id.lineItems.$lineId.mutate({ $id: cartId, $lineId: itemId, quantity });
      }
    },
    onSettled,
  });
}
