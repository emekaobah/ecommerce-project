import { ClientError } from '@oja/api-client';
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { storeClient } from './client';

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

export type Cart = Awaited<ReturnType<typeof fetchCart>>;
export type CartSellerGroup = Cart['sellers'][number];
export type CartItem = CartSellerGroup['items'][number];

export const isNotFound = (error: unknown) => error instanceof ClientError && error.status === 404;

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
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ offerId, quantity = 1 }: { offerId: string; quantity?: number }) => {
      const cartId = await cartIdForAdding();
      await storeClient.store.carts.$id.lineItems.mutate({ $id: cartId, offer_id: offerId, quantity });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: cartKeys.all }),
  });
}

/** Sets a line's quantity; 0 removes it. */
export function useSetCartItemQuantity(cartId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, quantity }: { itemId: string; quantity: number }) => {
      if (quantity === 0) {
        await storeClient.store.carts.$id.lineItems.$lineId.delete({ $id: cartId, $lineId: itemId });
      } else {
        await storeClient.store.carts.$id.lineItems.$lineId.mutate({ $id: cartId, $lineId: itemId, quantity });
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: cartKeys.all }),
  });
}
