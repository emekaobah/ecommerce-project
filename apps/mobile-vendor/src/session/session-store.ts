import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

export type Session = {
  /** Member JWT from `loginMember`. */
  token: string;
  /** Shop the member is acting for. */
  sellerId: string;
};

export type SessionState =
  | { status: 'hydrating' }
  | { status: 'signedOut' }
  /** Signed in as a member of several shops, before picking one. */
  | { status: 'choosingShop'; token: string }
  | { status: 'signedIn'; session: Session };

const TOKEN_KEY = 'member-token';
const SELLER_KEY = 'seller-id';

// Held outside React so the API client can read it on every request.
let state: SessionState = { status: 'hydrating' };
const listeners = new Set<() => void>();

// Keychain writes run one at a time, so a quick sign-in can't interleave with sign-out's deletes.
let keychain: Promise<unknown> = Promise.resolve();
function queueKeychain(write: () => Promise<unknown>): Promise<unknown> {
  keychain = keychain.then(write, write);
  return keychain;
}

function setState(next: SessionState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function getSession(): Session | undefined {
  return state.status === 'signedIn' ? state.session : undefined;
}

/** The member JWT, whether or not a shop has been picked yet. */
export function getToken(): string | undefined {
  if (state.status === 'signedIn') return state.session.token;
  if (state.status === 'choosingShop') return state.token;
  return undefined;
}

/** Restores the persisted session. The root layout holds the splash screen until this settles. */
export async function hydrateSession(): Promise<void> {
  try {
    const [token, sellerId] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY),
      SecureStore.getItemAsync(SELLER_KEY),
    ]);
    if (!token) setState({ status: 'signedOut' });
    // Closed before picking a shop: back to the shop picker.
    else if (!sellerId) setState({ status: 'choosingShop', token });
    else setState({ status: 'signedIn', session: { token, sellerId } });
  } catch {
    // An unreadable keychain (e.g. after a device restore) means signing in again, not a stuck splash.
    setState({ status: 'signedOut' });
  }
}

export async function saveSession(session: Session): Promise<void> {
  await queueKeychain(() =>
    Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, session.token),
      SecureStore.setItemAsync(SELLER_KEY, session.sellerId),
    ])
  );
  setState({ status: 'signedIn', session });
}

/** Keeps the member signed in with no shop picked, so the shop picker shows. */
export async function saveTokenForShopChoice(token: string): Promise<void> {
  await queueKeychain(() =>
    Promise.all([SecureStore.setItemAsync(TOKEN_KEY, token), SecureStore.deleteItemAsync(SELLER_KEY)])
  );
  setState({ status: 'choosingShop', token });
}

export async function clearSession(): Promise<void> {
  // Leave the signed-in screens straight away; the keychain catches up.
  setState({ status: 'signedOut' });
  await queueKeychain(() =>
    Promise.all([SecureStore.deleteItemAsync(TOKEN_KEY), SecureStore.deleteItemAsync(SELLER_KEY)])
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSessionState(): SessionState {
  return useSyncExternalStore(subscribe, () => state);
}

/** The signed-in session. Undefined for the one render between sign-out and leaving the signed-in group. */
export function useSession(): Session | undefined {
  const current = useSessionState();
  return current.status === 'signedIn' ? current.session : undefined;
}
