import * as SecureStore from 'expo-secure-store';

// The cart id lives on the device (ADR 0001): one for the guest, and one per buyer who has
// signed in here, so signing out never hands a buyer's cart to the next guest.

const GUEST = 'guest';

function keyFor(userId: string | null) {
  return `oja.cart.${userId ?? GUEST}`;
}

export async function readCartId(userId: string | null): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(keyFor(userId));
  } catch {
    // An unreadable keychain (e.g. after a device restore) starts a new cart rather than failing.
    return null;
  }
}

export async function saveCartId(userId: string | null, cartId: string): Promise<void> {
  await SecureStore.setItemAsync(keyFor(userId), cartId);
}

export async function forgetCartId(userId: string | null): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(userId));
}
