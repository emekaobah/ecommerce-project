import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import type { ShopHours } from '@/api/shop-hours';

/**
 * The shop's name and hours from the last visit, kept on the phone so the Orders header shows
 * them at once while counts and orders load (catalogue states #12, "Orders, loading").
 */
export type ShopSnapshot = { sellerId: string; name: string | null; hours: ShopHours | null };

const SNAPSHOT_KEY = 'shop-snapshot';

let snapshot: ShopSnapshot | null = null;
const listeners = new Set<() => void>();

function setSnapshot(next: ShopSnapshot | null) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

/** Reads the snapshot kept on the last visit; a missing or unreadable one just means no head start. */
export async function hydrateShopSnapshot(): Promise<void> {
  try {
    const stored = await SecureStore.getItemAsync(SNAPSHOT_KEY);
    setSnapshot(stored ? (JSON.parse(stored) as ShopSnapshot) : null);
  } catch {
    setSnapshot(null);
  }
}

/** Keeps what the server just said about the shop for the next visit. Writes only when it changed. */
export function rememberShop(sellerId: string, update: { name?: string | null; hours?: ShopHours | null }): void {
  const base = snapshot?.sellerId === sellerId ? snapshot : { sellerId, name: null, hours: null };
  const next = { ...base, ...update };
  const value = JSON.stringify(next);
  if (snapshot && JSON.stringify(snapshot) === value) return;
  setSnapshot(next);
  void SecureStore.setItemAsync(SNAPSHOT_KEY, value).catch(() => undefined);
}

/** Forgets the shop on sign-out, so the next member never sees it. */
export async function forgetShopSnapshot(): Promise<void> {
  setSnapshot(null);
  await SecureStore.deleteItemAsync(SNAPSHOT_KEY).catch(() => undefined);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The snapshot of this shop from the last visit, if there is one. */
export function useShopSnapshot(sellerId: string | undefined): ShopSnapshot | null {
  const current = useSyncExternalStore(subscribe, () => snapshot);
  return sellerId && current?.sellerId === sellerId ? current : null;
}
