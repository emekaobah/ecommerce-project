import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

/**
 * How a new order shows while the app is open (#83): full screen, or as a banner. A setting of
 * this phone, not of the member or shop, so it outlives sign-out (catalogue a11y 2.2.4, 3.2.5).
 */
export type NewOrderAlertMode = 'takeover' | 'banner';

const KEY = 'new-order-alert';

// Held outside React so the push handler can read it when a push arrives.
let mode: NewOrderAlertMode = 'takeover';
const listeners = new Set<() => void>();

function setMode(next: NewOrderAlertMode) {
  mode = next;
  listeners.forEach((listener) => listener());
}

export function getNewOrderAlertMode(): NewOrderAlertMode {
  return mode;
}

/** Restores the phone's choice; full screen until it is read, or if it can't be. */
export async function hydrateNewOrderAlertMode(): Promise<void> {
  try {
    if ((await SecureStore.getItemAsync(KEY)) === 'banner') setMode('banner');
  } catch {
    // An unreadable keychain keeps the default: a new order still takes over the screen.
  }
}

export async function setNewOrderAlertMode(next: NewOrderAlertMode): Promise<void> {
  setMode(next);
  await SecureStore.setItemAsync(KEY, next);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNewOrderAlertMode(): NewOrderAlertMode {
  return useSyncExternalStore(subscribe, () => mode);
}
