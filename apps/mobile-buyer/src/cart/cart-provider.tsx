import { useAuth } from '@clerk/expo';
import { cartOnSignIn } from '@oja/domain';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { createCart, fetchCartIfAny, mergeCart, transferCart } from '@/api/cart';
import { useRegion } from '@/region/region-provider';

import { forgetCartId, readCartId, saveCartId, type CartOwner } from './cart-id-store';

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
 * when they sign in (ADR 0001), merged into the buyer's own cart when they had one here;
 * signing out leaves the buyer's cart with their account.
 */
export function CartProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { isLoaded, userId } = useAuth();
  const { region } = useRegion();
  const owner: CartOwner = userId ?? null;
  const [cartId, setCartId] = useState<string | null | undefined>(undefined);
  // One cart per owner, even when adds race before the first cart exists.
  const pendingCart = useRef<Promise<string> | null>(null);
  // Who the app is shopping for now, so a cart started for someone else isn't shown.
  const currentOwner = useRef(owner);
  currentOwner.current = owner;

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    setCartId(undefined);
    pendingCart.current = null;
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
    pendingCart.current ??= createCart(region.id).then(async (id) => {
      // Saved for whoever it was started for; shown only if they're still the one shopping.
      await saveCartId(owner, id);
      if (currentOwner.current === owner) setCartId(id);
      return id;
    });
    try {
      return await pendingCart.current;
    } catch (error) {
      pendingCart.current = null;
      throw error;
    }
  }, [cartId, owner, region]);

  const forgetCart = useCallback(() => {
    pendingCart.current = null;
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

/**
 * Whether a cart is the one this device shops with, rather than a shop cart: one shop's items
 * paid for on their own (#11), while the app's cart keeps the other shops'.
 */
export function useIsAppCart(cartId: string | null | undefined): boolean {
  return useCartSession().cartId === cartId;
}

/** The guest's cart, or for a buyer who just signed in, the cart `cartOnSignIn` picks. */
async function cartForOwner(userId: CartOwner): Promise<string | null> {
  if (!userId) return readCartId(null);
  const [guestCartId, buyerCartId] = await Promise.all([readCartId(null), readCartId(userId)]);
  if (!guestCartId) return buyerCartId;
  try {
    const [guestCart, buyerCart] = await Promise.all([
      fetchCartIfAny(guestCartId),
      buyerCartId ? fetchCartIfAny(buyerCartId) : null,
    ]);
    const choice = cartOnSignIn({
      guestCart: guestCart && { id: guestCartId, itemCount: guestCart.item_count },
      buyerCart: buyerCart && buyerCartId ? { id: buyerCartId, itemCount: buyerCart.item_count } : null,
    });
    if (choice.kind === 'merge') await mergeCart(choice.cartId, choice.fromCartId);
    if (choice.kind === 'adopt-guest') {
      await transferCart(choice.cartId);
      await saveCartId(userId, choice.cartId);
    }
    if (choice.cartId === null && buyerCartId) await forgetCartId(userId);
    await forgetCartId(null);
    return choice.cartId;
  } catch {
    // Offline or the store failed: keep the guest cart's id, so the next launch carries it over
    // (merging with anything added meanwhile), and shop with the buyer's own cart until then.
    return buyerCartId;
  }
}
