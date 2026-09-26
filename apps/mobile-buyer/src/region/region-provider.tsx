import { selectRegion } from '@oja/domain';
import { getLocales } from 'expo-localization';
import { createContext, useContext, type ReactNode } from 'react';

import { useRegions, type Region } from '@/api/regions';

type RegionState = {
  /** Undefined until the backend's regions have loaded. */
  region: Region | undefined;
  error: Error | null;
  retry: () => void;
};

const RegionContext = createContext<RegionState | null>(null);

/**
 * Resolves the shopping region from the backend's regions and the device's country.
 * Prices and currency always come from this region; none is hardcoded.
 */
export function RegionProvider({ children }: { children: ReactNode }) {
  const regions = useRegions();
  const country = getLocales()[0]?.regionCode;
  const region = regions.data ? selectRegion(regions.data, country) : undefined;
  const error =
    regions.error ?? (regions.data && !region ? new Error('The store has no regions set up yet.') : null);

  return (
    <RegionContext.Provider
      value={{ region, error, retry: () => void regions.refetch() }}>
      {children}
    </RegionContext.Provider>
  );
}

export function useRegion(): RegionState {
  const state = useContext(RegionContext);
  if (!state) throw new Error('useRegion must be used inside RegionProvider');
  return state;
}
