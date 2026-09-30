import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { cartKeys } from './cart';
import { storeClient } from './client';

export const wishlistKeys = {
  all: ['wishlist'] as const,
  /** Keyed by Clerk user so one buyer never sees another's cached wishlist. */
  list: (userId: string, regionId: string) => [...wishlistKeys.all, { userId, regionId }] as const,
};

async function fetchWishlist(regionId: string) {
  const { items } = await storeClient.store.wishlist.query({ region_id: regionId });
  return items;
}

export type WishlistItem = Awaited<ReturnType<typeof fetchWishlist>>[number];

/** The signed-in buyer's saved products, newest first, each as its saved shop's listing. Idle for guests. */
export function useWishlist(userId: string | null | undefined, regionId: string | undefined) {
  return useQuery({
    queryKey: wishlistKeys.list(userId ?? '', regionId ?? ''),
    queryFn: userId && regionId ? () => fetchWishlist(regionId) : skipToken,
  });
}

function useRefetchWishlistAfterWrite() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: wishlistKeys.all });
}

/** Saves a product from the shop it is shown in, or removes it. */
export function useToggleWishlist() {
  const onSettled = useRefetchWishlistAfterWrite();
  return useMutation({
    mutationFn: async ({ sellerId, productId, save }: { sellerId: string; productId: string; save: boolean }) => {
      if (save) {
        await storeClient.store.wishlist.mutate({ reference: 'product', reference_id: productId, seller_id: sellerId });
      } else {
        await storeClient.store.wishlist.product.$referenceId.delete({ $referenceId: productId });
      }
    },
    onSettled,
  });
}

/** Moves a saved product into the cart `cartIdForAdding` resolves, as its saved shop's offer. */
export function useMoveToCart(cartIdForAdding: () => Promise<string>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, offerId }: { productId: string; offerId: string }) => {
      const cartId = await cartIdForAdding();
      await storeClient.store.wishlist.product.$referenceId.cart.mutate({
        $referenceId: productId,
        cart_id: cartId,
        offer_id: offerId,
        quantity: 1,
      });
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: wishlistKeys.all }),
        queryClient.invalidateQueries({ queryKey: cartKeys.all }),
      ]),
  });
}
