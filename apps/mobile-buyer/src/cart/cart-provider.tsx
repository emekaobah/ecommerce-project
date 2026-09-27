import { useAuth } from '@clerk/expo';
import { cartOnSignIn } from '@oja/domain';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { createCart, fetchCart, isNotFound, transferCart } from '@/api/cart';
import { useRegion } from '@/region/region-provider';

import { forgetCartId, readCartId, saveCartId } from './cart-id-store';

type CartSession = {
  /** Undefined while the device's cart is restored; null when there is none yet. */
  cartId: string | null | undefined;
  /** The cart to add to, started in the buyer's region on the first add. */
  cartIdForAdding: () => Promise<string>;
  /** Drops a cart the store no longer has (e.g. after a database reset); the next add starts a new one. */
  forgetCart: () => void;
};

const CartContext = createContext<CartSession | null>(null);

/**
 * The cart this device shops with, persisted so it survives restarts. A guest's cart is kept
 * when they sign in (ADR 0001); signing out leaves the buyer's cart with their account.
 */
export function CartProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { isLoaded, userId } = useAuth();
  const { region } = useRegion();
  const owner = userId ?? null;
  const [cartId, setCartId] = useState<string | null | undefined>(undefined);
  // One cart per owner, even when adds race before the first cart exists.
  const creating = useRef<Promise<string> | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    setCartId(undefined);
    creating.current = null;
    void cartForOwner(owner).then((id) => {
      if (!cancelled) setCartId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, owner]);

  const cartIdForAdding = useCallback(async () => {
    if (cartId) return cartId;
    if (cartId === undefined) throw new Error('Your cart is still loading. Try again in a moment.');
    if (!region) throw new Error("Couldn't reach the store. Try again in a moment.");
    creating.current ??= createCart(region.id).then(async (id) => {
      await saveCartId(owner, id);
      setCartId(id);
      return id;
    });
    try {
      return await creating.current;
    } catch (error) {
      creating.current = null;
      throw error;
    }
  }, [cartId, owner, region]);

  const forgetCart = useCallback(() => {
    creating.current = null;
    setCartId(null);
    void forgetCartId(owner);
  }, [owner]);

  const value = useMemo(() => ({ cartId, cartIdForAdding, forgetCart }), [cartId, cartIdForAdding, forgetCart]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCartSession(): CartSession {
  const session = useContext(CartContext);
  if (!session) throw new Error('useCartSession must be used inside CartProvider');
  return session;
}

/** The guest's cart, or for a buyer who just signed in, the cart `cartOnSignIn` picks. */
async function cartForOwner(userId: string | null): Promise<string | null> {
  if (!userId) return readCartId(null);
  const [guestCartId, buyerCartId] = await Promise.all([readCartId(null), readCartId(userId)]);
  if (!guestCartId) return buyerCartId;
  try {
    const guestCart = await fetchCart(guestCartId).catch((error: unknown) => {
      if (isNotFound(error)) return null;
      throw error;
    });
    const choice = cartOnSignIn({
      guestCart: guestCart && { id: guestCartId, itemCount: guestCart.item_count },
      buyerCartId,
    });
    if (choice.kind === 'adopt-guest') {
      await transferCart(choice.cartId);
      await saveCartId(userId, choice.cartId);
    }
    await forgetCartId(null);
    return choice.cartId;
  } catch {
    // Offline or the store failed: keep the guest cart's id so the carry-over is retried on the
    // next launch, and shop with the buyer's own cart meanwhile.
    return buyerCartId;
  }
}
