import { useAuth } from '@clerk/expo';
import { deliveringTo } from '@oja/domain';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useSavedAddresses, type SavedAddressRecord } from '@/api/addresses';

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
  /** The signed-in buyer's saved addresses won't load; `retry` asks again. */
  failed: boolean;
  retry: () => void;
  /** Delivers to another saved address, remembered on the device until changed. */
  pick: (addressId: string) => void;
};

const DeliveringToContext = createContext<DeliveringToState | null>(null);

/**
 * "Delivering to": the signed-in buyer's default saved address, or the one they picked on Home
 * or Search, which the device remembers. A picked address that was deleted falls back to the
 * default. The app sends only the address's id; the backend measures from its pin.
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

  const pickedId = picked?.userId === userId ? picked?.id : undefined;
  const address = useMemo(() => {
    if (!isLoaded) return undefined;
    if (!userId || addresses.error) return null;
    if (!addresses.data || pickedId === undefined) return undefined;
    const id = deliveringTo(addresses.data, pickedId);
    return addresses.data.find((a) => a.id === id) ?? null;
  }, [isLoaded, userId, addresses.data, addresses.error, pickedId]);

  const failed = !!userId && !!addresses.error;
  const { refetch } = addresses;
  const retry = useCallback(() => void refetch(), [refetch]);
  const value = useMemo<DeliveringToState>(
    () => ({ address, saved: userId ? addresses.data : undefined, signedIn: isLoaded && !!userId, failed, retry, pick }),
    [address, userId, isLoaded, addresses.data, failed, retry, pick]
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
