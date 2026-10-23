import type { ShopHours } from '@/api/shop-hours';
import { keptValue } from '@/storage/kept-value';

/**
 * The shop's name and hours from the last visit, kept on the phone so the Orders header shows
 * them at once while counts and orders load (catalogue states #12, "Orders, loading").
 */
export type ShopSnapshot = { sellerId: string; name: string | null; hours: ShopHours | null };

const snapshot = keptValue<ShopSnapshot | null>('shop-snapshot', null, {
  parse: (stored) => JSON.parse(stored) as ShopSnapshot,
  stringify: (value) => JSON.stringify(value),
});

/** Reads the snapshot kept on the last visit; a missing or unreadable one just means no head start. */
export const hydrateShopSnapshot = snapshot.hydrate;

/** Keeps what the server just said about the shop for the next visit. Writes only when it changed. */
export function rememberShop(sellerId: string, update: { name?: string | null; hours?: ShopHours | null }): void {
  const current = snapshot.get();
  const base = current?.sellerId === sellerId ? current : { sellerId, name: null, hours: null };
  const next = { ...base, ...update };
  if (current && JSON.stringify(current) === JSON.stringify(next)) return;
  // Only a head start: one not kept is fetched again next visit.
  snapshot.save(next).catch(() => undefined);
}

/** Forgets the shop on sign-out, so the next member never sees it. */
export async function forgetShopSnapshot(): Promise<void> {
  await snapshot.forget().catch(() => undefined);
}

/** The snapshot of this shop from the last visit, if there is one. */
export function useShopSnapshot(sellerId: string | undefined): ShopSnapshot | null {
  const current = snapshot.use();
  return sellerId && current?.sellerId === sellerId ? current : null;
}
