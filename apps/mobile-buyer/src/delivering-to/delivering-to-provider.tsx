import { useAuth } from '@clerk/expo';
import { deliveringTo, type GuestSpot, type MeasuredFrom } from '@oja/domain';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useSavedAddresses, type SavedAddressRecord } from '@/api/addresses';

import { readGuestSpot, saveGuestSpot } from './guest-spot-store';
import { locateSpot, type Located } from './locate-spot';
import { readPickedAddressId, savePickedAddressId } from './picked-address-store';

type DeliveringToState = {
  /**
   * The saved address listings are measured from and checkout starts on (#43, ADR 0011).
   * Undefined while it is worked out; null for a guest, a buyer without saved addresses (or
   * whose addresses won't load), or one with neither a picked nor a default address.
   */
  address: SavedAddressRecord | null | undefined;
  /** The buyer's saved addresses; undefined for a guest, while they load, or when they won't load. */
  saved: SavedAddressRecord[] | undefined;
  /** Whether a buyer is signed in; false for a guest and until Clerk has loaded. */
  signedIn: boolean;
  /** Why the signed-in buyer's saved addresses won't load; `retry` asks again. */
  error: Error | null;
  retry: () => void;
  /** Delivers to another saved address, remembered on the device until changed. */
  pick: (addressId: string) => void;
  /**
   * The guest's spot (ADR 0015): where their phone was when they last shared it, which shops are
   * measured from while there's no saved address. Undefined while it is read from the device;
   * null when there is none, and once the buyer has a saved address, which replaces it.
   */
  near: GuestSpot | null | undefined;
  /** Finds where the phone is and keeps it as the spot; says why when it can't. */
  locate: () => Promise<Located>;
};

const DeliveringToContext = createContext<DeliveringToState | null>(null);

/**
 * "Delivering to": the signed-in buyer's default saved address, or the one they picked on Home
 * or Search, which the device remembers. A picked address that was deleted falls back to the
 * default. The app sends only the address's id; the backend measures from its pin. Without a
 * saved address, a guest's spot is sent as `near` instead (ADR 0015), kept on the device until
 * the buyer has a saved address.
 */
export function DeliveringToProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { isLoaded, userId } = useAuth();
  const addresses = useSavedAddresses(userId);
  /** The id the device remembers for this buyer: undefined until read, null when none. */
  const [picked, setPicked] = useState<{ userId: string; id: string | null } | undefined>(undefined);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void readPickedAddressId(userId).then((id) => {
      if (!cancelled) setPicked({ userId, id });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const pick = useCallback(
    (addressId: string) => {
      if (!userId) return;
      setPicked({ userId, id: addressId });
      void savePickedAddressId(userId, addressId);
    },
    [userId]
  );

  const [spot, setSpot] = useState<GuestSpot | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void readGuestSpot().then((read) => {
      if (!cancelled) setSpot((current) => (current === undefined ? read : current));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const locate = useCallback(async () => {
    const located = await locateSpot();
    if ('spot' in located) {
      setSpot(located.spot);
      void saveGuestSpot(located.spot);
    }
    return located;
  }, []);

  // A saved address replaces the spot for good, on the device too.
  const hasSaved = !!userId && !!addresses.data?.length;
  if (hasSaved && spot) setSpot(null);
  useEffect(() => {
    if (hasSaved) void saveGuestSpot(null);
  }, [hasSaved]);
  const near = hasSaved ? null : spot;

  const pickedId = picked?.userId === userId ? picked?.id : undefined;
  const address = useMemo(() => {
    if (!isLoaded) return undefined;
    if (!userId || addresses.error) return null;
    if (!addresses.data || pickedId === undefined) return undefined;
    const id = deliveringTo(addresses.data, pickedId);
    return addresses.data.find((a) => a.id === id) ?? null;
  }, [isLoaded, userId, addresses.data, addresses.error, pickedId]);

  const error = userId ? addresses.error : null;
  const { refetch } = addresses;
  const retry = useCallback(() => void refetch(), [refetch]);
  const value = useMemo<DeliveringToState>(
    () => ({
      address,
      saved: userId ? addresses.data : undefined,
      signedIn: isLoaded && !!userId,
      error,
      retry,
      pick,
      near,
      locate,
    }),
    [address, userId, isLoaded, addresses.data, error, retry, pick, near, locate]
  );
  return <DeliveringToContext.Provider value={value}>{children}</DeliveringToContext.Provider>;
}

export function useDeliveringTo(): DeliveringToState {
  const state = useContext(DeliveringToContext);
  if (!state) throw new Error('useDeliveringTo must be used inside DeliveringToProvider');
  return state;
}

/** The id of the address listings are measured from: undefined while it is worked out, null for none. */
export function useDeliveringToId(): string | null | undefined {
  const { address } = useDeliveringTo();
  return address === undefined ? undefined : (address?.id ?? null);
}

/**
 * Where listings and shops are measured from: the saved address, else the guest's spot, else
 * nowhere; undefined while either is worked out, so a query waits rather than loading twice.
 */
export function useMeasuredFrom(): MeasuredFrom | undefined {
  const { address, near } = useDeliveringTo();
  if (address === undefined) return undefined;
  if (address) return { addressId: address.id, near: null };
  if (near === undefined) return undefined;
  return { addressId: null, near: near && { latitude: near.latitude, longitude: near.longitude } };
}
