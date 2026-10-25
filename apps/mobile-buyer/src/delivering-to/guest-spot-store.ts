import type { GuestSpot } from '@oja/domain';
import * as SecureStore from 'expo-secure-store';

// A guest's spot (ADR 0015) lives on the device only, until a saved address replaces it.

const KEY = 'oja.guest-spot';

function isSpot(value: unknown): value is GuestSpot {
  const spot = value as Partial<GuestSpot> | null;
  return (
    typeof spot?.latitude === 'number' &&
    typeof spot.longitude === 'number' &&
    (typeof spot.name === 'string' || spot.name === null)
  );
}

export async function readGuestSpot(): Promise<GuestSpot | null> {
  try {
    const stored = await SecureStore.getItemAsync(KEY);
    const spot: unknown = stored ? JSON.parse(stored) : null;
    return isSpot(spot) ? spot : null;
  } catch {
    // An unreadable keychain, or a value from another build, is no spot.
    return null;
  }
}

export async function saveGuestSpot(spot: GuestSpot | null): Promise<void> {
  try {
    if (spot) await SecureStore.setItemAsync(KEY, JSON.stringify(spot));
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // An unwritable keychain keeps the spot for this session only.
  }
}
